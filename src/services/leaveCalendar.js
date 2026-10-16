const { pool } = require('../config/db');
const { LEAVE_TYPES } = require('../constants/leave');
const { parseDate } = require('../utils/leave');
const { getHolidaySet } = require('./holidays');

/**
 * Approved leave days from the in-app leave module, expanded per calendar day.
 * Returns Map<`${employee_id}_${YYYY-MM-DD}`, { label, halfDay }>.
 * Weekends and public holidays are only included for types that count calendar days.
 * Fails soft (empty map) so attendance keeps working before migration 004 runs.
 */
async function approvedLeaveMap(from, to) {
  const map = new Map();
  try {
    const [rows] = await pool.query(
      `SELECT employee_id, leave_type, half_day, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
       FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`,
      [to, from]
    );
    const holidays = rows.length ? await getHolidaySet(from, to) : new Set();
    const lo = parseDate(from);
    const hi = parseDate(to);
    rows.forEach(r => {
      const type = LEAVE_TYPES[r.leave_type] || { label: 'ลา', countCalendarDays: false };
      const start = parseDate(r.start_date);
      const end = parseDate(r.end_date);
      for (let d = new Date(Math.max(start, lo)); d <= end && d <= hi; d.setUTCDate(d.getUTCDate() + 1)) {
        const dow = d.getUTCDay();
        const key = d.toISOString().slice(0, 10);
        if (!type.countCalendarDays && (dow === 0 || dow === 6 || holidays.has(key))) continue;
        map.set(`${r.employee_id}_${key}`, { label: type.label, halfDay: r.half_day });
      }
    });
  } catch (err) {
    console.warn('[leaveCalendar] approved leaves unavailable:', err.message);
  }
  return map;
}

/** Look up a person by either session-username form (FINGLE_ID or HR_CID). */
function leaveFor(map, ids, dateStr) {
  for (const id of ids) {
    if (id && map.has(`${id}_${dateStr}`)) return map.get(`${id}_${dateStr}`);
  }
  return null;
}

module.exports = { approvedLeaveMap, leaveFor };
