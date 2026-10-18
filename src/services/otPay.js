/**
 * Overtime pay (ค่าตอบแทนการปฏิบัติงานนอกเวลาราชการ).
 *
 * Defaults follow the Ministry of Finance regulation (พ.ศ. 2550) as commonly applied:
 * working days 50 ฿/h up to 4 h a day, weekends/holidays 60 ฿/h up to 7 h a day.
 * Every value is editable per staff type (HR_STATUS_NAME) in Settings and must be confirmed by
 * the finance unit — professional duty allowances (ค่าเวร) under MOPH rules often differ.
 */
const { pool } = require('../config/db');

const KEY = 'ot_rates';
const DEFAULT_RULE = { weekdayRate: 50, weekdayMaxHours: 4, holidayRate: 60, holidayMaxHours: 7 };
const DEFAULTS = { default: { ...DEFAULT_RULE }, byStatus: {} };
const TTL_MS = 60 * 1000;
let cache = { value: null, at: 0 };

function validateRule(r, label) {
  const out = {};
  for (const [k, max] of [['weekdayRate', 5000], ['holidayRate', 5000], ['weekdayMaxHours', 24], ['holidayMaxHours', 24]]) {
    const v = Number(r && r[k]);
    if (!Number.isFinite(v) || v < 0 || v > max) return { error: `${label}: ${k.includes('Rate') ? 'อัตรา' : 'ชั่วโมงสูงสุด'}ไม่ถูกต้อง` };
    out[k] = Math.round(v * 100) / 100;
  }
  return { value: out };
}

function validate(input) {
  const p = input || {};
  const d = validateRule(p.default, 'ค่าเริ่มต้น');
  if (d.error) return d;
  const byStatus = {};
  const entries = Object.entries(p.byStatus || {});
  if (entries.length > 50) return { error: 'ประเภทบุคลากรมากเกินไป' };
  for (const [status, rule] of entries) {
    if (typeof status !== 'string' || !status.trim() || status.length > 150) return { error: 'ชื่อประเภทบุคลากรไม่ถูกต้อง' };
    const r = validateRule(rule, status);
    if (r.error) return r;
    byStatus[status.trim()] = r.value;
  }
  return { value: { default: d.value, byStatus } };
}

async function getOtRates() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
    if (rows.length) {
      const raw = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
      const v = validate(raw);
      if (v.value) value = v.value;
    }
  } catch (err) {
    console.warn('[otPay] using defaults:', err.message);
  }
  cache = { value, at: Date.now() };
  return value;
}

async function saveOtRates(value, by) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [KEY, JSON.stringify(value), by]);
  cache = { value: null, at: 0 };
}

const ruleFor = (rates, status) => (status && rates.byStatus[status]) || rates.default;

/**
 * Price approved OT requests (pure, unit-tested).
 * requests: [{ id, employee_id, work_date:'YYYY-MM-DD', hours }]
 * The daily cap applies per person per day across all their requests, in request order.
 * Returns { lines: Map(id → { dayType, rate, paidHours, amount }), byEmployee: { [emp]: { hours, paidHours, amount } } }
 */
function priceOt(requests, { rates, holidays = new Set(), statusOf = () => null }) {
  const used = {};
  const lines = new Map();
  const byEmployee = {};
  const ordered = [...requests].sort((a, b) => a.work_date.localeCompare(b.work_date) || Number(a.id) - Number(b.id));
  for (const r of ordered) {
    const dow = new Date(`${r.work_date}T12:00:00Z`).getUTCDay();
    const holiday = dow === 0 || dow === 6 || holidays.has(r.work_date);
    const rule = ruleFor(rates, statusOf(r.employee_id));
    const cap = holiday ? rule.holidayMaxHours : rule.weekdayMaxHours;
    const rate = holiday ? rule.holidayRate : rule.weekdayRate;
    const key = `${r.employee_id}|${r.work_date}`;
    const hours = Number(r.hours) || 0;
    const paidHours = Math.max(0, Math.min(hours, cap - (used[key] || 0)));
    used[key] = (used[key] || 0) + paidHours;
    const amount = Math.round(paidHours * rate * 100) / 100;
    lines.set(r.id, { dayType: holiday ? 'holiday' : 'weekday', rate, paidHours, amount });
    const e = byEmployee[r.employee_id] = byEmployee[r.employee_id] || { hours: 0, paidHours: 0, amount: 0 };
    e.hours += hours; e.paidHours += paidHours; e.amount = Math.round((e.amount + amount) * 100) / 100;
  }
  return { lines, byEmployee };
}

module.exports = { KEY, DEFAULTS, validate, getOtRates, saveOtRates, priceOt, ruleFor };
