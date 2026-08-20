/**
 * Given a shift start time (HH:MM) and a grace period in minutes, returns the
 * clock-in time after which an employee is considered late, as HH:MM:SS.
 * Rolls over past 23:59 by wrapping to the next day's clock (mod 24h), since
 * this is only ever compared against a same-day AccessTime string.
 */
function calculateLateThreshold(workStart, lateMinutes) {
  const [h, m] = workStart.split(':').map(Number);
  const totalMinutes = (((h * 60 + m + lateMinutes) % 1440) + 1440) % 1440;
  const lateH = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const lateM = (totalMinutes % 60).toString().padStart(2, '0');
  return `${lateH}:${lateM}:00`;
}

module.exports = { calculateLateThreshold };
