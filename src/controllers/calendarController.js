const { pool, hosofficePool } = require('../config/db');
const { LEAVE_TYPES } = require('../constants/leave');
const { parseDate } = require('../utils/leave');
const { POLICY_KEY, getLeavePolicy } = require('../services/leavePolicy');
const { logAudit } = require('../utils/audit');

const isAdmin = u => u && (u.role === 'admin' || u.role === 'super');

// Thai public holidays that fall on the same date every year.
// Lunar holidays (มาฆบูชา, วิสาขบูชา, อาสาฬหบูชา, เข้าพรรษา) and substitution days change yearly — add them manually.
const FIXED_HOLIDAYS = [
  ['01-01', 'วันขึ้นปีใหม่'],
  ['04-06', 'วันพระบาทสมเด็จพระพุทธยอดฟ้าจุฬาโลกมหาราชและวันที่ระลึกมหาจักรีบรมราชวงศ์'],
  ['04-13', 'วันสงกรานต์'],
  ['04-14', 'วันสงกรานต์'],
  ['04-15', 'วันสงกรานต์'],
  ['05-04', 'วันฉัตรมงคล'],
  ['06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
  ['07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
  ['08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง และวันแม่แห่งชาติ'],
  ['10-13', 'วันนวมินทรมหาราช'],
  ['10-23', 'วันปิยมหาราช'],
  ['12-05', 'วันคล้ายวันพระบรมราชสมภพ รัชกาลที่ 9 วันชาติ และวันพ่อแห่งชาติ'],
  ['12-10', 'วันรัฐธรรมนูญ'],
  ['12-31', 'วันสิ้นปี']
];

exports.listHolidays = async (req, res) => {
  const year = Number(req.query.year);
  const { from, to } = req.query;
  let range;
  if (parseDate(from) && parseDate(to)) range = [from, to];
  else if (Number.isInteger(year) && year > 1900 && year < 3000) range = [`${year}-01-01`, `${year}-12-31`];
  else return res.status(400).json({ success: false, error: 'ระบุปีหรือช่วงวันที่' });
  try {
    const [rows] = await pool.query(
      "SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS date, name, created_by FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date",
      range
    );
    res.json({ success: true, holidays: rows });
  } catch (error) {
    console.error('Error listing holidays:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถโหลดวันหยุดได้ (ตรวจสอบว่ารัน npm run migrate แล้ว)', holidays: [] });
  }
};

exports.saveHoliday = async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const { date } = req.body || {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!parseDate(date)) return res.status(400).json({ success: false, error: 'วันที่ไม่ถูกต้อง' });
  if (!name || name.length > 150) return res.status(400).json({ success: false, error: 'ระบุชื่อวันหยุด (ไม่เกิน 150 ตัวอักษร)' });
  try {
    await pool.query(
      'INSERT INTO holidays (holiday_date, name, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), created_by = VALUES(created_by)',
      [date, name, user.fullname]
    );
    logAudit(req, 'upsert', 'holiday', date, { name });
    res.json({ success: true, message: 'บันทึกวันหยุดแล้ว' });
  } catch (error) {
    console.error('Error saving holiday:', error);
    res.status(500).json({ success: false, error: 'บันทึกวันหยุดไม่สำเร็จ' });
  }
};

exports.deleteHoliday = async (req, res) => {
  if (!isAdmin(req.session.user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  if (!parseDate(req.params.date)) return res.status(400).json({ success: false, error: 'วันที่ไม่ถูกต้อง' });
  try {
    const [result] = await pool.query('DELETE FROM holidays WHERE holiday_date = ?', [req.params.date]);
    if (result.affectedRows) logAudit(req, 'delete', 'holiday', req.params.date);
    res.json({ success: true, message: 'ลบวันหยุดแล้ว' });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    res.status(500).json({ success: false, error: 'ลบวันหยุดไม่สำเร็จ' });
  }
};

/** Insert the fixed-date holidays for a year; existing dates are left untouched. */
exports.addFixedHolidays = async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const year = Number(req.body && req.body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ success: false, error: 'ปีไม่ถูกต้อง' });
  try {
    const values = FIXED_HOLIDAYS.map(([md, name]) => [`${year}-${md}`, name, user.fullname]);
    const [result] = await pool.query('INSERT IGNORE INTO holidays (holiday_date, name, created_by) VALUES ?', [values]);
    logAudit(req, 'import', 'holiday', String(year), { added: result.affectedRows });
    res.json({ success: true, added: result.affectedRows, message: `เพิ่มวันหยุด ${result.affectedRows} วัน` });
  } catch (error) {
    console.error('Error importing holidays:', error);
    res.status(500).json({ success: false, error: 'เพิ่มวันหยุดไม่สำเร็จ' });
  }
};

/* ---------------- Leave policy (quotas per staff type) ---------------- */

function validatePolicy(input) {
  const p = input || {};
  const days = Number(p.attachmentSickDays);
  if (!Number.isInteger(days) || days < 0 || days > 60) return { error: 'จำนวนวันที่ต้องแนบใบรับรองแพทย์ต้องเป็น 0–60' };
  const byStatus = {};
  const entries = Object.entries(p.byStatus || {});
  if (entries.length > 50) return { error: 'ประเภทบุคลากรมากเกินไป' };
  for (const [status, quotas] of entries) {
    if (typeof status !== 'string' || !status.trim() || status.length > 150) return { error: 'ชื่อประเภทบุคลากรไม่ถูกต้อง' };
    const row = {};
    for (const key of Object.keys(LEAVE_TYPES)) {
      if (!quotas || quotas[key] === undefined || quotas[key] === '') continue;
      const v = quotas[key] === null ? null : Number(quotas[key]);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 365)) return { error: `สิทธิ์${LEAVE_TYPES[key].label}ของ ${status} ไม่ถูกต้อง` };
      row[key] = v;
    }
    if (Object.keys(row).length) byStatus[status.trim()] = row;
  }
  return { value: { attachmentSickDays: days, byStatus } };
}
exports.validatePolicy = validatePolicy;

exports.getPolicy = async (req, res) => {
  if (!isAdmin(req.session.user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  try {
    const policy = await getLeavePolicy();
    let statuses = [];
    try {
      const [rows] = await hosofficePool.query(
        `SELECT s.HR_STATUS_NAME AS name, COUNT(p.ID) AS staff FROM hr_status s
         LEFT JOIN hr_person p ON p.HR_STATUS_ID = s.HR_STATUS_ID
         WHERE s.HR_STATUS_NAME IS NOT NULL GROUP BY s.HR_STATUS_ID, s.HR_STATUS_NAME ORDER BY s.HR_STATUS_ID`
      );
      statuses = rows.map(r => ({ name: r.name, staff: Number(r.staff) || 0 }));
    } catch (err) {
      console.warn('[policy] hr_status unavailable:', err.message);
    }
    res.json({ success: true, policy, statuses, types: LEAVE_TYPES });
  } catch (error) {
    console.error('Error loading leave policy:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถโหลดนโยบายการลาได้' });
  }
};

exports.savePolicy = async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'super') return res.status(403).json({ success: false, error: 'เฉพาะ Super Admin เท่านั้นที่แก้ไขสิทธิ์การลาได้' });
  const { error, value } = validatePolicy(req.body);
  if (error) return res.status(400).json({ success: false, error });
  try {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [POLICY_KEY, JSON.stringify(value), user.fullname]
    );
    logAudit(req, 'update', 'leave_policy', null, value);
    res.json({ success: true, policy: value });
  } catch (err) {
    console.error('Error saving leave policy:', err);
    res.status(500).json({ success: false, error: 'บันทึกนโยบายการลาไม่สำเร็จ' });
  }
};
