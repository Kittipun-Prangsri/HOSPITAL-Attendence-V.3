const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('../services/notificationService');
const { validateOtRequest, otInterval, overlaps } = require('../utils/ot');
const { parseDate } = require('../utils/leave');
const { logAudit } = require('../utils/audit');

const OT_COLUMNS = `id, employee_id, hr_person_id, fullname, dept, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
  start_time, end_time, hours, reason, status, reviewer, review_comment, submitted_at, reviewed_at`;

const isReviewer = u => u && (u.role === 'admin' || u.role === 'super');
const thaiDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

exports.listOt = async (req, res) => {
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
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    if (parseDate(from) && parseDate(to)) {
      where.push('work_date BETWEEN ? AND ?');
      params.push(from, to);
    }
    const [rows] = await pool.query(
      `SELECT ${OT_COLUMNS} FROM ot_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (status = 'pending') DESC, work_date DESC, id DESC LIMIT 1000`,
      params
    );
    res.json({ success: true, requests: rows });
  } catch (error) {
    console.error('Error listing OT:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูล OT ได้ (ตรวจสอบว่ารัน npm run migrate แล้ว)', requests: [] });
  }
};

exports.createOt = async (req, res) => {
  const user = req.session.user;
  const { error, value } = validateOtRequest(req.body);
  if (error) return res.status(400).json({ success: false, error });
  try {
    const [sameDay] = await pool.query(
      "SELECT start_time, end_time FROM ot_requests WHERE employee_id = ? AND work_date = ? AND status IN ('pending', 'approved')",
      [user.username, value.workDate]
    );
    if (sameDay.some(r => overlaps(otInterval(r.start_time, r.end_time), value.interval))) {
      return res.status(409).json({ success: false, error: 'มีคำขอ OT ช่วงเวลานี้อยู่แล้ว' });
    }
    let dept = null;
    try {
      const [p] = await hosofficePool.query(
        `SELECT d.HR_DEPARTMENT_NAME AS dept FROM hr_person p LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID WHERE p.ID = ? LIMIT 1`,
        [user.id]
      );
      dept = p[0] ? p[0].dept : null;
    } catch (lookupErr) {
      console.warn('OT dept lookup failed:', lookupErr.message);
    }
    const [result] = await pool.query(
      `INSERT INTO ot_requests (employee_id, hr_person_id, fullname, dept, work_date, start_time, end_time, hours, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.id || null, user.fullname, dept, value.workDate, value.startTime, value.endTime, value.hours, value.reason]
    );
    logAudit(req, 'create', 'ot', result.insertId, { date: value.workDate, from: value.startTime, to: value.endTime, hours: value.hours });
    NotificationService.sendToAdmin(
      `⏱ *มีคำขอ OT ใหม่*\n\n👤 ${user.fullname}${dept ? ` · ${dept}` : ''}\n📅 ${thaiDate(value.workDate)} ${value.startTime}–${value.endTime} (${value.hours} ชม.)\n💬 ${value.reason}`
    ).catch(err => console.warn('OT admin notify failed:', err.message));
    res.json({ success: true, id: result.insertId, message: 'ส่งคำขอ OT แล้ว รอผู้ดูแลระบบอนุมัติ' });
  } catch (error) {
    console.error('Error creating OT:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกคำขอ OT' });
  }
};

exports.cancelOt = async (req, res) => {
  const user = req.session.user;
  try {
    const [rows] = await pool.query('SELECT employee_id, status FROM ot_requests WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'ไม่พบคำขอ OT' });
    if (rows[0].employee_id !== user.username) return res.status(403).json({ success: false, error: 'ยกเลิกได้เฉพาะคำขอของตนเอง' });
    if (rows[0].status !== 'pending') return res.status(400).json({ success: false, error: 'ยกเลิกได้เฉพาะคำขอที่ยังรออนุมัติ' });
    await pool.query("UPDATE ot_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [req.params.id]);
    logAudit(req, 'cancel', 'ot', req.params.id);
    res.json({ success: true, message: 'ยกเลิกคำขอ OT แล้ว' });
  } catch (error) {
    console.error('Error cancelling OT:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการยกเลิก' });
  }
};

exports.reviewOt = async (req, res) => {
  const user = req.session.user;
  if (!isReviewer(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const { status, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'ผลการพิจารณาไม่ถูกต้อง' });
  if (comment != null && (typeof comment !== 'string' || comment.length > 1000)) return res.status(400).json({ success: false, error: 'ความเห็นยาวเกินไป' });
  try {
    const [rows] = await pool.query(`SELECT ${OT_COLUMNS} FROM ot_requests WHERE id = ?`, [req.params.id]);
    const ot = rows[0];
    if (!ot) return res.status(404).json({ success: false, error: 'ไม่พบคำขอ OT' });
    if (ot.status !== 'pending') return res.status(409).json({ success: false, error: 'คำขอนี้ถูกพิจารณาหรือยกเลิกไปแล้ว' });
    if (ot.employee_id === user.username) return res.status(403).json({ success: false, error: 'ไม่สามารถอนุมัติคำขอของตนเองได้' });
    await pool.query(
      "UPDATE ot_requests SET status = ?, reviewer = ?, review_comment = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
      [status, user.fullname, comment ? comment.trim() || null : null, ot.id]
    );
    logAudit(req, status === 'approved' ? 'approve' : 'reject', 'ot', ot.id, { employee: ot.fullname, hours: Number(ot.hours), comment: comment || null });
    if (ot.hr_person_id) {
      try {
        const [p] = await hosofficePool.query('SELECT LINE_YOUR_USER_ID AS line_user_id, TELEGRAM_CHAT_ID AS telegram_chat_id FROM hr_person WHERE ID = ? LIMIT 1', [ot.hr_person_id]);
        if (p[0]) {
          await NotificationService.sendDirectNotification(p[0].line_user_id, p[0].telegram_chat_id,
            `🔔 *ผลการพิจารณา OT*\n\n📅 ${thaiDate(ot.work_date)} ${ot.start_time}–${ot.end_time} (${Number(ot.hours)} ชม.)\n` +
            `📍 ผล: ${status === 'approved' ? '✅ อนุมัติ' : '❌ ไม่อนุมัติ'}\n👤 ผู้พิจารณา: ${user.fullname}\n💬 ${comment || 'ไม่มีความเห็นเพิ่มเติม'}`);
        }
      } catch (notifyErr) {
        console.warn('OT review notify failed:', notifyErr.message);
      }
    }
    res.json({ success: true, message: status === 'approved' ? 'อนุมัติ OT แล้ว' : 'ไม่อนุมัติ OT แล้ว' });
  } catch (error) {
    console.error('Error reviewing OT:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกผล' });
  }
};
