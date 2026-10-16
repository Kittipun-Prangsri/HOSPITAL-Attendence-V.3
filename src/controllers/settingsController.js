const { pool } = require('../config/db');
const { logAudit } = require('../utils/audit');

const SETTINGS_KEY = 'work_settings';
const TIME_RE = /^([01]\d|2[0-4]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const STAFF_TYPES = ['doctor', 'nurse', 'staff', 'support'];

/** Validate the settings object shared by the topbar settings modal. Returns { error } or { value }. */
function validateSettings(input) {
  const s = input || {};
  if (!TIME_RE.test(s.workStart) || !TIME_RE.test(s.workEnd)) return { error: 'เวลาเริ่ม/เลิกงานไม่ถูกต้อง' };
  const lateMin = Number(s.lateMin);
  if (!Number.isInteger(lateMin) || lateMin < 0 || lateMin > 180) return { error: 'เกณฑ์มาสายต้องเป็น 0–180 นาที' };
  if (!Array.isArray(s.workDays) || s.workDays.some(d => !DAYS.includes(d))) return { error: 'วันทำงานไม่ถูกต้อง' };
  if (!['none', 'daily', 'weekly'].includes(s.autoReport)) return { error: 'รูปแบบรายงานอัตโนมัติไม่ถูกต้อง' };
  const staffHours = {};
  for (const type of STAFF_TYPES) {
    const h = (s.staffHours || {})[type] || {};
    const ot = Number(h.ot);
    if (!TIME_RE.test(h.start) || !TIME_RE.test(h.end) || !Number.isFinite(ot) || ot < 1 || ot > 24) {
      return { error: 'เวลาทำงานบุคลากรไม่ถูกต้อง' };
    }
    staffHours[type] = { start: h.start, end: h.end, ot };
  }
  if (!Array.isArray(s.shifts) || s.shifts.length === 0 || s.shifts.length > 10) return { error: 'ต้องมีประเภทเวร 1–10 รายการ' };
  const shifts = [];
  for (const sh of s.shifts) {
    const name = typeof sh.name === 'string' ? sh.name.trim() : '';
    if (!name || name.length > 30 || !TIME_RE.test(sh.start) || !TIME_RE.test(sh.end)) return { error: 'ข้อมูลประเภทเวรไม่ถูกต้อง' };
    shifts.push({ name, start: sh.start, end: sh.end, color: COLOR_RE.test(sh.color) ? sh.color : '#6366F1' });
  }
  return { value: { workStart: s.workStart, workEnd: s.workEnd, lateMin, workDays: [...new Set(s.workDays)], autoReport: s.autoReport, staffHours, shifts } };
}

exports.validateSettings = validateSettings;

exports.getSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_value, updated_by, updated_at FROM app_settings WHERE setting_key = ?', [SETTINGS_KEY]);
    if (!rows.length) return res.json({ success: true, settings: null });
    const raw = rows[0].setting_value;
    res.json({ success: true, settings: typeof raw === 'string' ? JSON.parse(raw) : raw, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถโหลดการตั้งค่าได้' });
  }
};

exports.saveSettings = async (req, res) => {
  const user = req.session.user;
  if (!user || (user.role !== 'admin' && user.role !== 'super')) {
    return res.status(403).json({ success: false, error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขการตั้งค่าได้' });
  }
  const { error, value } = validateSettings(req.body);
  if (error) return res.status(400).json({ success: false, error });
  try {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [SETTINGS_KEY, JSON.stringify(value), user.fullname]
    );
    logAudit(req, 'update', 'settings', null, value);
    res.json({ success: true, settings: value });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ success: false, error: 'บันทึกการตั้งค่าไม่สำเร็จ' });
  }
};
