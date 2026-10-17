const { pool, hosofficePool } = require('../config/db');
const { markIncidentsStale } = require('../services/incidentSync');
const NotificationService = require('../services/notificationService');
const { LEAVE_TYPES } = require('../constants/leave');
const { validateLeaveRequest, fiscalYearOf, summarizeBalance, parseDate, attachmentRequired } = require('../utils/leave');
const { getHolidaySet } = require('../services/holidays');
const { getLeavePolicy, quotasForEmployee } = require('../services/leavePolicy');
const { decodeAttachment, saveAttachment, resolveAttachment, removeAttachment } = require('../utils/attachments');
const { logAudit } = require('../utils/audit');

const LEAVE_COLUMNS = `id, employee_id, hr_person_id, fullname, dept, leave_type,
  DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
  half_day, days, reason, contact, status, reviewer, review_comment, submitted_at, reviewed_at,
  attachment_name, (attachment_path IS NOT NULL) AS has_attachment`;

const { reviewScope, canReview, scopeFilter } = require('../services/reviewScope');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });
const thaiDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const rangeText = r => (r.start_date === r.end_date ? thaiDate(r.start_date) : `${thaiDate(r.start_date)} – ${thaiDate(r.end_date)}`);

async function requestsInFiscalYear(employeeId, dateStr) {
  const fy = fiscalYearOf(dateStr);
  const [rows] = await pool.query(
    `SELECT leave_type, days, status FROM leave_requests
     WHERE employee_id = ? AND start_date BETWEEN ? AND ? AND status IN ('approved', 'pending')`,
    [employeeId, fy.start, fy.end]
  );
  return { fy, rows };
}

exports.getTypes = async (req, res) => {
  const policy = await getLeavePolicy();
  res.json({ success: true, types: LEAVE_TYPES, attachmentSickDays: policy.attachmentSickDays });
};

/** List requests. Everyone sees their own; reviewers may pass scope=all with optional filters. */
exports.listLeaves = async (req, res) => {
  const user = req.session.user;
  const { scope, status, from, to } = req.query;
  try {
    const where = [];
    const params = [];
    if (scope === 'all') {
      // Admins see everyone; department heads see their departments
      const rs = await reviewScope(user);
      if (!rs) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
      const f = scopeFilter(rs, { personCol: 'hr_person_id', employeeCol: 'employee_id' });
      if (f.sql) { where.push(f.sql); params.push(...f.params); }
    } else {
      where.push('employee_id = ?');
      params.push(user.username);
    }
    if (status && ['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    // Overlap filter: requests touching [from, to]
    if (parseDate(from) && parseDate(to)) {
      where.push('start_date <= ? AND end_date >= ?');
      params.push(to, from);
    }
    const [rows] = await pool.query(
      `SELECT ${LEAVE_COLUMNS} FROM leave_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (status = 'pending') DESC, start_date DESC, id DESC LIMIT 500`,
      params
    );
    res.json({ success: true, leaves: rows });
  } catch (error) {
    console.error('Error listing leaves:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลการลาได้', leaves: [] });
  }
};

/** Balance for the current fiscal year (reviewers may query another employee). */
exports.getBalance = async (req, res) => {
  const user = req.session.user;
  let employeeId = user.username;
  if (req.query.employee_id && String(req.query.employee_id) !== user.username) {
    if (!canReview(await reviewScope(user), { employeeId: String(req.query.employee_id) })) {
      return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
    }
    employeeId = String(req.query.employee_id);
  }
  try {
    const [{ fy, rows }, { status, quotas }] = await Promise.all([
      requestsInFiscalYear(employeeId, parseDate(req.query.date) ? req.query.date : todayStr()),
      quotasForEmployee(employeeId)
    ]);
    res.json({ success: true, fiscalYear: fy, staffStatus: status, balance: summarizeBalance(rows, quotas) });
  } catch (error) {
    console.error('Error getting leave balance:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถคำนวณสิทธิ์วันลาได้' });
  }
};

exports.createLeave = async (req, res) => {
  const user = req.session.user;
  const body = req.body || {};
  const holidays = parseDate(body.start_date) && parseDate(body.end_date) ? await getHolidaySet(body.start_date, body.end_date) : null;
  const { error, value } = validateLeaveRequest(body, holidays);
  if (error) return res.status(400).json({ success: false, error });

  const policy = await getLeavePolicy();
  let attachment = null;
  if (body.attachment) {
    const decoded = decodeAttachment(body.attachment);
    if (decoded.error) return res.status(400).json({ success: false, error: decoded.error });
    attachment = decoded.value;
  } else if (attachmentRequired(policy, value.leaveType, value.days)) {
    return res.status(400).json({ success: false, error: `ลาป่วยตั้งแต่ ${policy.attachmentSickDays} วันขึ้นไป ต้องแนบใบรับรองแพทย์` });
  }

  let storedFile = null;
  try {
    const [overlap] = await pool.query(
      `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending', 'approved')
       AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [user.username, value.endDate, value.startDate]
    );
    if (overlap.length) return res.status(409).json({ success: false, error: 'มีใบลาในช่วงวันที่นี้อยู่แล้ว' });

    const type = LEAVE_TYPES[value.leaveType];
    const { quotas } = await quotasForEmployee(user.username, policy);
    if (quotas[value.leaveType] != null) {
      const { rows } = await requestsInFiscalYear(user.username, value.startDate);
      const row = summarizeBalance(rows, quotas)[value.leaveType];
      if (value.days > row.remaining) {
        return res.status(400).json({ success: false, error: `${type.label}คงเหลือ ${row.remaining} วัน ไม่พอสำหรับ ${value.days} วัน` });
      }
    }

    let dept = null;
    try {
      const [p] = await hosofficePool.query(
        `SELECT d.HR_DEPARTMENT_NAME AS dept FROM hr_person p
         LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID WHERE p.ID = ? LIMIT 1`,
        [user.id]
      );
      dept = p[0] ? p[0].dept : null;
    } catch (lookupErr) {
      console.warn('Leave dept lookup failed:', lookupErr.message);
    }

    if (attachment) storedFile = await saveAttachment(attachment);
    const [result] = await pool.query(
      `INSERT INTO leave_requests (employee_id, hr_person_id, fullname, dept, leave_type, start_date, end_date, half_day, days, reason, contact,
         attachment_path, attachment_name, attachment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.id || null, user.fullname, dept, value.leaveType, value.startDate, value.endDate,
        value.halfDay, value.days, value.reason, value.contact,
        storedFile, attachment ? attachment.name : null, attachment ? attachment.type : null]
    );
    storedFile = null; // owned by the row now
    logAudit(req, 'create', 'leave', result.insertId, { type: value.leaveType, from: value.startDate, to: value.endDate, days: value.days, attachment: !!attachment });

    const half = value.halfDay === 'morning' ? ' (ครึ่งเช้า)' : value.halfDay === 'afternoon' ? ' (ครึ่งบ่าย)' : '';
    NotificationService.sendToAdmin(
      `📝 *มีใบลาใหม่รออนุมัติ*\n\n👤 ${user.fullname}${dept ? ` · ${dept}` : ''}\n📌 ${type.label} ${value.days} วัน${half}\n` +
      `📅 ${rangeText({ start_date: value.startDate, end_date: value.endDate })}\n💬 ${value.reason}`
    ).catch(err => console.warn('Leave admin notify failed:', err.message));

    res.json({ success: true, id: result.insertId, message: 'ส่งใบลาเรียบร้อยแล้ว รอผู้ดูแลระบบอนุมัติ' });
  } catch (error) {
    if (storedFile) removeAttachment(storedFile);
    console.error('Error creating leave:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกใบลา' });
  }
};

exports.cancelLeave = async (req, res) => {
  const user = req.session.user;
  try {
    const [rows] = await pool.query('SELECT employee_id, status FROM leave_requests WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'ไม่พบใบลา' });
    if (rows[0].employee_id !== user.username) return res.status(403).json({ success: false, error: 'ยกเลิกได้เฉพาะใบลาของตนเอง' });
    if (rows[0].status !== 'pending') return res.status(400).json({ success: false, error: 'ยกเลิกได้เฉพาะใบลาที่ยังรออนุมัติ' });
    await pool.query("UPDATE leave_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [req.params.id]);
    logAudit(req, 'cancel', 'leave', req.params.id);
    res.json({ success: true, message: 'ยกเลิกใบลาแล้ว' });
  } catch (error) {
    console.error('Error cancelling leave:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการยกเลิกใบลา' });
  }
};

exports.reviewLeave = async (req, res) => {
  const user = req.session.user;
  const rs = await reviewScope(user);
  if (!rs) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const { status, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'ผลการพิจารณาไม่ถูกต้อง' });
  if (comment != null && (typeof comment !== 'string' || comment.length > 1000)) {
    return res.status(400).json({ success: false, error: 'ความเห็นยาวเกินไป' });
  }
  try {
    const [rows] = await pool.query(`SELECT ${LEAVE_COLUMNS} FROM leave_requests WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'ไม่พบใบลา' });
    const leave = rows[0];
    if (leave.status !== 'pending') return res.status(409).json({ success: false, error: 'ใบลานี้ถูกพิจารณาหรือยกเลิกไปแล้ว' });
    if (leave.employee_id === user.username) return res.status(403).json({ success: false, error: 'ไม่สามารถอนุมัติใบลาของตนเองได้' });
    if (!canReview(rs, { hrPersonId: leave.hr_person_id, employeeId: leave.employee_id })) {
      return res.status(403).json({ success: false, error: 'พิจารณาได้เฉพาะบุคลากรในกลุ่มงานที่ท่านดูแล' });
    }

    await pool.query(
      `UPDATE leave_requests SET status = ?, reviewer = ?, review_comment = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [status, user.fullname, comment ? comment.trim() || null : null, leave.id]
    );
    markIncidentsStale({ from: leave.start_date, to: leave.end_date });
    logAudit(req, status === 'approved' ? 'approve' : 'reject', 'leave', leave.id, { employee: leave.fullname, days: Number(leave.days), comment: comment || null });

    if (leave.hr_person_id) {
      try {
        const [p] = await hosofficePool.query(
          'SELECT LINE_YOUR_USER_ID AS line_user_id, TELEGRAM_CHAT_ID AS telegram_chat_id FROM hr_person WHERE ID = ? LIMIT 1',
          [leave.hr_person_id]
        );
        if (p[0]) {
          const type = LEAVE_TYPES[leave.leave_type];
          await NotificationService.sendDirectNotification(p[0].line_user_id, p[0].telegram_chat_id,
            `🔔 *ผลการพิจารณาใบลา*\n\n📌 ${type ? type.label : leave.leave_type} ${Number(leave.days)} วัน\n📅 ${rangeText(leave)}\n` +
            `📍 ผล: ${status === 'approved' ? '✅ อนุมัติ' : '❌ ไม่อนุมัติ'}\n👤 ผู้พิจารณา: ${user.fullname}\n💬 ${comment || 'ไม่มีความเห็นเพิ่มเติม'}`);
        }
      } catch (notifyErr) {
        console.warn('Leave review notify failed:', notifyErr.message);
      }
    }
    res.json({ success: true, message: status === 'approved' ? 'อนุมัติใบลาแล้ว' : 'ไม่อนุมัติใบลาแล้ว' });
  } catch (error) {
    console.error('Error reviewing leave:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกผล' });
  }
};

/** Stream a leave attachment to its owner or a reviewer. */
exports.getAttachment = async (req, res) => {
  const user = req.session.user;
  try {
    const [rows] = await pool.query('SELECT employee_id, hr_person_id, attachment_path, attachment_name, attachment_type FROM leave_requests WHERE id = ?', [req.params.id]);
    const row = rows[0];
    if (!row || !row.attachment_path) return res.status(404).json({ success: false, error: 'ไม่พบไฟล์แนบ' });
    if (row.employee_id !== user.username && !canReview(await reviewScope(user), { hrPersonId: row.hr_person_id, employeeId: row.employee_id })) {
      return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
    }
    const full = resolveAttachment(row.attachment_path);
    if (!full) return res.status(404).json({ success: false, error: 'ไม่พบไฟล์แนบ' });
    logAudit(req, 'view', 'leave_attachment', req.params.id);
    res.setHeader('Content-Type', row.attachment_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.attachment_name || 'attachment')}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.sendFile(full, err => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (error) {
    console.error('Error reading attachment:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถเปิดไฟล์แนบได้' });
  }
};
