const { LEAVE_TYPES, FISCAL_YEAR_START_MONTH, MAX_LEAVE_SPAN_DAYS } = require('../constants/leave');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse YYYY-MM-DD as a UTC date so day arithmetic never shifts with the server timezone
function parseDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

const isWorkingDay = (date, holidays) => {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && !(holidays && holidays.has(formatDate(date)));
};

/**
 * Days charged for a request: working days (Mon–Fri, excluding public holidays)
 * unless the type counts calendar days.
 */
function countLeaveDays(startStr, endStr, leaveType, halfDay = 'none', holidays = null) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const type = LEAVE_TYPES[leaveType];
  if (!start || !end || !type || end < start) return 0;
  if (halfDay !== 'none') {
    if (startStr !== endStr) return 0;
    return type.countCalendarDays || isWorkingDay(start, holidays) ? 0.5 : 0;
  }
  let days = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (type.countCalendarDays || isWorkingDay(d, holidays)) days += 1;
  }
  return days;
}

/** Quotas for a staff status: policy override merged over the regulation defaults. */
function quotasForStatus(policy, statusName) {
  const override = (policy && policy.byStatus && statusName && policy.byStatus[statusName]) || {};
  const quotas = {};
  Object.entries(LEAVE_TYPES).forEach(([key, type]) => {
    const v = override[key];
    quotas[key] = v === null || (Number.isFinite(v) && v >= 0) ? v : type.quota;
  });
  return quotas;
}

/** Whether a request needs a supporting document under the policy. */
function attachmentRequired(policy, leaveType, days) {
  const threshold = policy && Number.isFinite(policy.attachmentSickDays) ? policy.attachmentSickDays : 3;
  return leaveType === 'sick' && threshold > 0 && days >= threshold;
}

/** Fiscal year (Buddhist era label + date range) containing the given YYYY-MM-DD. */
function fiscalYearOf(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return null;
  const startYear = date.getUTCMonth() + 1 >= FISCAL_YEAR_START_MONTH ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const mm = String(FISCAL_YEAR_START_MONTH).padStart(2, '0');
  const start = `${startYear}-${mm}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, FISCAL_YEAR_START_MONTH - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return { label: startYear + 1 + 543, start, end: formatDate(endDate) };
}

/**
 * Validate a leave request body. Returns { error } or { value } with normalized fields.
 */
function validateLeaveRequest(body, holidays = null) {
  const { leave_type: leaveType, start_date: startDate, end_date: endDate, reason, contact } = body || {};
  const halfDay = body && body.half_day ? body.half_day : 'none';
  if (!LEAVE_TYPES[leaveType]) return { error: 'ประเภทการลาไม่ถูกต้อง' };
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return { error: 'วันที่ไม่ถูกต้อง' };
  if (end < start) return { error: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา' };
  if ((end - start) / 864e5 + 1 > MAX_LEAVE_SPAN_DAYS) return { error: `ลาได้ไม่เกิน ${MAX_LEAVE_SPAN_DAYS} วันต่อครั้ง` };
  if (!['none', 'morning', 'afternoon'].includes(halfDay)) return { error: 'ช่วงเวลาลาไม่ถูกต้อง' };
  if (halfDay !== 'none' && startDate !== endDate) return { error: 'ลาครึ่งวันต้องเป็นวันเดียวกัน' };
  if (typeof reason !== 'string' || !reason.trim()) return { error: 'กรุณาระบุเหตุผลการลา' };
  if (reason.length > 1000) return { error: 'เหตุผลยาวเกินไป (ไม่เกิน 1000 ตัวอักษร)' };
  if (contact != null && (typeof contact !== 'string' || contact.length > 255)) return { error: 'ข้อมูลติดต่อไม่ถูกต้อง' };
  // A range that falls entirely on weekends would charge 0 days for working-day types
  const days = countLeaveDays(startDate, endDate, leaveType, halfDay, holidays);
  if (days <= 0) return { error: 'ช่วงวันที่เลือกไม่มีวันทำการ' };
  if (fiscalYearOf(startDate).label !== fiscalYearOf(endDate).label) return { error: 'ใบลาหนึ่งใบต้องอยู่ในปีงบประมาณเดียวกัน กรุณาแยกเป็น 2 ใบ' };
  return {
    value: {
      leaveType, startDate, endDate, halfDay, days,
      reason: reason.trim(),
      contact: contact ? contact.trim() || null : null
    }
  };
}

/**
 * Summarize used / pending days per leave type.
 * @param {object} [quotas] per-type overrides, e.g. { vacation: 0 } for staff without vacation entitlement
 */
function summarizeBalance(requests, quotas = {}) {
  const balance = {};
  Object.entries(LEAVE_TYPES).forEach(([key, type]) => {
    const quota = quotas && quotas[key] !== undefined ? quotas[key] : type.quota;
    balance[key] = { label: type.label, quota, used: 0, pending: 0, remaining: quota };
  });
  requests.forEach(r => {
    const row = balance[r.leave_type];
    if (!row) return;
    const days = Number(r.days) || 0;
    if (r.status === 'approved') row.used += days;
    else if (r.status === 'pending') row.pending += days;
  });
  Object.values(balance).forEach(row => {
    row.remaining = row.quota == null ? null : Math.max(0, row.quota - row.used - row.pending);
  });
  return balance;
}

module.exports = { parseDate, formatDate, countLeaveDays, fiscalYearOf, validateLeaveRequest, summarizeBalance, quotasForStatus, attachmentRequired };
