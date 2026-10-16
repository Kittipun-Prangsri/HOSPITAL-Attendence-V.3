const DEFAULT_TIMEZONE = 'Asia/Bangkok';

function getTimeInTimezone(date = new Date(), timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('hour')}:${value('minute')}:${value('second')}`;
}

function isLateCheckIn(time, threshold = '08:31:00') {
  return /^\d{2}:\d{2}:\d{2}$/.test(time) && /^\d{2}:\d{2}:\d{2}$/.test(threshold) && time > threshold;
}

/** 'H:MM', 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS' (null when not a clock time). */
function normalizeClock(value) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value == null ? '' : value).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

/**
 * Late threshold as 'HH:MM:00' = work start + grace minutes.
 * Single rule for every screen and notification: late when check-in > threshold.
 */
function lateThresholdFor({ workStart = '08:00', lateMin = 31 } = {}) {
  const start = normalizeClock(workStart) || '08:00:00';
  const grace = Number.isFinite(Number(lateMin)) ? Math.max(0, Math.min(180, Number(lateMin))) : 31;
  const [h, m] = start.split(':').map(Number);
  const total = Math.min(h * 60 + m + grace, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

/** Convenience: is this scan time late under the given settings? Accepts HH:MM or HH:MM:SS. */
function isLateAt(time, settings) {
  const t = normalizeClock(time);
  return Boolean(t) && isLateCheckIn(t, lateThresholdFor(settings));
}

module.exports = { getTimeInTimezone, isLateCheckIn, normalizeClock, lateThresholdFor, isLateAt };
