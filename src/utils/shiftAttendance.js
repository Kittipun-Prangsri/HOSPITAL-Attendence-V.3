/**
 * Shift-aware attendance rules used by the incident engine.
 *
 * - A day with a roster entry (schedule_entries) is judged against that shift's start time.
 * - Shift workers (hiling template 2) are only expected on rostered days: their days off are not
 *   absences, and with no roster at all we cannot tell, so nothing is generated for them.
 * - Office staff (template 1) keep the weekday rule; rostered weekend/holiday duty counts too.
 */
const { toShiftLabel, toShiftCode } = require('./shifts');

// Usual Thai hospital shifts; Settings → ประเภทเวร overrides by name (เช้า / บ่าย / ดึก or custom)
const DEFAULT_STARTS = { MORNING: '08:00', AFTERNOON: '16:00', NIGHT: '00:00' };
const BEFORE_MS = 3 * 60 * 60 * 1000;   // arriving up to 3 h early still counts for this shift
const AFTER_MS = 8 * 60 * 60 * 1000;    // first scan more than 8 h after start = did not come

/** 'HH:MM' start of a stored shift code/name, from Settings first, then the defaults; null if unknown. */
function shiftStartFor(shift, settingsShifts = []) {
  const label = toShiftLabel(shift);
  const hit = (settingsShifts || []).find(s => s && typeof s.name === 'string' && s.name.trim() === label);
  if (hit && /^\d{2}:\d{2}$/.test(hit.start)) return hit.start;
  return DEFAULT_STARTS[toShiftCode(shift)] || null;
}

/** 'roster' (judge by shift), 'office' (weekday rule), or 'off' (not expected). */
function dayPlan({ templateId, rosterShift, isWorkday }) {
  if (rosterShift) return 'roster';
  if (Number(templateId) === 2) return 'off';
  return isWorkday ? 'office' : 'off';
}

const startMs = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  // '24:00' means midnight at the end of that day
  return new Date(`${date}T00:00:00+07:00`).getTime() + (h * 60 + m) * 60000;
};

/**
 * Judge one rostered day. scanMs: ascending epoch-ms of that person's scans around the day.
 * @returns {{ result: 'ok'|'late'|'absent', firstScanMs: number|null }}
 */
function judgeRosteredDay({ date, start, lateMin, scanMs }) {
  const s = startMs(date, start);
  const first = scanMs.find(t => t >= s - BEFORE_MS && t <= s + AFTER_MS);
  if (first === undefined) return { result: 'absent', firstScanMs: null };
  return { result: first > s + lateMin * 60000 ? 'late' : 'ok', firstScanMs: first };
}

module.exports = { shiftStartFor, dayPlan, judgeRosteredDay, DEFAULT_STARTS };
