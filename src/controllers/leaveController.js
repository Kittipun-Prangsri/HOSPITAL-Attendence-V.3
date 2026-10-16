const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('../services/notificationService');
const { LEAVE_TYPES } = require('../constants/leave');
const { validateLeaveRequest, fiscalYearOf, summarizeBalance, parseDate } = require('../utils/leave');

const LEAVE_COLUMNS = `id, employee_id, hr_person_id, fullname, dept, leave_type,
  DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
  half_day, days, reason, contact, status, reviewer, review_comment, submitted_at, reviewed_at`;

const isReviewer = user => user && (user.role === 'admin' || user.role === 'super');
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

exports.getTypes = (req, res) => {
  res.json({ success: true, types: LEAVE_TYPES });
};

/** List requests. Everyone sees their own; reviewers may pass scope=all with optional filters. */
exports.listLeaves = async (req, res) => {
  const user = req.session.user;
  const { scope, status, from, to } = req.query;
  try {
    const where = [];
    const params = [];
    if (scope === 'all') {
      if (!isReviewer(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
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
  const employeeId = isReviewer(user) && req.query.employee_id ? String(req.query.employee_id) : user.username;
  try {
    const { fy, rows } = await requestsInFiscalYear(employeeId, parseDate(req.query.date) ? req.query.date : todayStr());
    res.json({ success: true, fiscalYear: fy, balance: summarizeBalance(rows) });
  } catch (error) {
    console.error('Error getting leave balance:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถคำนวณสิทธิ์วันลาได้' });
  }
};

exports.createLeave = async (req, res) => {
  const user = req.session.user;
  const { error, value } = validateLeaveRequest(req.body);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const [overlap] = await pool.query(
      `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending', 'approved')
       AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [user.username, value.endDate, value.startDate]
    );
    if (overlap.length) return res.status(409).json({ success: false, error: 'มีใบลาในช่วงวันที่นี้อยู่แล้ว' });

    const type = LEAVE_TYPES[value.leaveType];
    if (type.quota != null) {
      const { rows } = await requestsInFiscalYear(user.username, value.startDate);
      const row = summarizeBalance(rows)[value.leaveType];
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

    const [result] = await pool.query(
      `INSERT INTO leave_requests (employee_id, hr_person_id, fullname, dept, leave_type, start_date, end_date, half_day, days, reason, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.id || null, user.fullname, dept, value.leaveType, value.startDate, value.endDate,
        value.halfDay, value.days, value.reason, value.contact]
    );

    const half = value.halfDay === 'morning' ? ' (ครึ่งเช้า)' : value.halfDay === 'afternoon' ? ' (ครึ่งบ่าย)' : '';
    NotificationService.sendToAdmin(
      `📝 *มีใบลาใหม่รออนุมัติ*\n\n👤 ${user.fullname}${dept ? ` · ${dept}` : ''}\n📌 ${type.label} ${value.days} วัน${half}\n` +
      `📅 ${rangeText({ start_date: value.startDate, end_date: value.endDate })}\n💬 ${value.reason}`
    ).catch(err => console.warn('Leave admin notify failed:', err.message));

    res.json({ success: true, id: result.insertId, message: 'ส่งใบลาเรียบร้อยแล้ว รอผู้ดูแลระบบอนุมัติ' });
  } catch (error) {
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
    res.json({ success: true, message: 'ยกเลิกใบลาแล้ว' });
  } catch (error) {
    console.error('Error cancelling leave:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการยกเลิกใบลา' });
  }
};

exports.reviewLeave = async (req, res) => {
  const user = req.session.user;
  if (!isReviewer(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
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

    await pool.query(
      `UPDATE leave_requests SET status = ?, reviewer = ?, review_comment = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [status, user.fullname, comment ? comment.trim() || null : null, leave.id]
    );

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
