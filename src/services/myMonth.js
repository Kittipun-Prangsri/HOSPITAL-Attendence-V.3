/**
 * "เดือนนี้ของฉัน": one person's month, day by day, from the same sources as the reports
 * (hikvision scans, incident_logs, leaves, holidays, roster, excuses).
 */
const { pool, hosofficePool } = require('../config/db');
const { approvedLeaveMap, leaveFor } = require('./leaveCalendar');
const { getHolidaySet } = require('./holidays');
const { toDateKey } = require('../utils/attendanceTime');
const { toShiftLabel } = require('../utils/shifts');

/** Day status precedence: leave > absent > late > present > off/blank (unit-tested). */
function dayStatus({ future, off, leave, absent, late, scanned }) {
  if (future) return 'future';
  if (leave) return 'leave';
  if (absent) return 'absent';
  if (late) return 'late';
  if (scanned) return 'ok';
  return off ? 'off' : 'none';
}

async function myMonth({ person, ym }) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const from = `${ym}-01`;
  const to = `${ym}-${String(days).padStart(2, '0')}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const ids = [person.fingle_id, person.cid].filter(Boolean);

  const [scans] = await hosofficePool.query(
    `SELECT DATE_FORMAT(AccessDate, '%Y-%m-%d') AS d, TIME_FORMAT(MIN(AccessTime), '%H:%i') AS first, TIME_FORMAT(MAX(AccessTime), '%H:%i') AS last,
            COUNT(*) AS n, SUM(AuthenticationType = 'MobileFace') AS mobile
     FROM hikvision WHERE EmployeeID = ? AND AccessDate BETWEEN ? AND ? GROUP BY AccessDate`, [person.fingle_id, from, to]);
  const scanBy = Object.fromEntries(scans.map(s => [s.d, s]));
  const [inc] = await pool.query(
    'SELECT incident_date, incident_type, status FROM incident_logs WHERE employee_id = ? AND incident_date BETWEEN ? AND ?', [person.fingle_id, from, to]);
  const incBy = {};
  inc.forEach(r => { (incBy[toDateKey(r.incident_date)] = incBy[toDateKey(r.incident_date)] || {})[r.incident_type] = r.status; });
  const [ex] = await pool.query(
    'SELECT date, issue_type, status, admin_comment FROM attendance_excuses WHERE username IN (?) AND date BETWEEN ? AND ?', [ids, from, to]);
  const exBy = Object.fromEntries(ex.map(e => [toDateKey(e.date), { type: e.issue_type, status: e.status, comment: e.admin_comment }]));
  const [roster] = await pool.query(
    "SELECT DATE_FORMAT(schedule_date, '%Y-%m-%d') AS d, shift FROM schedule_entries WHERE employee_id = ? AND schedule_date BETWEEN ? AND ?", [person.fingle_id, from, to]);
  const rosterBy = Object.fromEntries(roster.map(r => [r.d, toShiftLabel(r.shift)]));
  const holidays = await getHolidaySet(from, to);
  const [hhRows] = await pool.query("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d, name FROM holidays WHERE holiday_date BETWEEN ? AND ?", [from, to]).catch(() => [[]]);
  const holidayName = Object.fromEntries(hhRows.map(h => [h.d, h.name]));
  const appLeaves = await approvedLeaveMap(from, to);
  const [hos] = await hosofficePool.query(
    `SELECT ${Array.from({ length: 31 }, (_, i) => `di${i + 1}`).join(', ')} FROM service_work_scans_morning WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1`,
    [person.id, ym]).catch(() => [[]]);

  const out = [];
  const totals = { ok: 0, late: 0, absent: 0, leave: 0 };
  for (let d = 1; d <= days; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const off = dow === 0 || dow === 6 || holidays.has(date);
    const hosCode = hos[0] && hos[0][`di${d}`];
    const hosLeave = hosCode && String(hosCode).trim() && !/^\d{2}:\d{2}/.test(String(hosCode)) ? String(hosCode).trim() : null;
    const app = leaveFor(appLeaves, ids, date);
    const s = scanBy[date];
    const status = dayStatus({
      future: date > today, off, leave: hosLeave || app, absent: incBy[date] && incBy[date].ABSENT,
      late: incBy[date] && incBy[date].LATE, scanned: Boolean(s)
    });
    if (totals[status] !== undefined) totals[status] += 1;
    out.push({
      date, day: d, dow, status, off,
      holiday: holidayName[date] || null,
      shift: rosterBy[date] || null,
      first: s ? s.first : null, last: s && s.n > 1 ? s.last : null, mobile: s ? Number(s.mobile) > 0 : false,
      leave: hosLeave || (app ? app.label : null),
      incident: incBy[date] ? (incBy[date].ABSENT ? { type: 'ABSENT', status: incBy[date].ABSENT } : { type: 'LATE', status: incBy[date].LATE }) : null,
      excuse: exBy[date] || null
    });
  }
  return { ym, days: out, totals };
}

module.exports = { myMonth, dayStatus };
