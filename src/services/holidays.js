const { pool } = require('../config/db');

/** Set of 'YYYY-MM-DD' public holidays in [from, to]. Empty (not an error) before migration 005. */
async function getHolidaySet(from, to) {
  try {
    const [rows] = await pool.query(
      "SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d FROM holidays WHERE holiday_date BETWEEN ? AND ?",
      [from, to]
    );
    return new Set(rows.map(r => r.d));
  } catch (err) {
    console.warn('[holidays] unavailable:', err.message);
    return new Set();
  }
}

/** Expand [{ start, end }] ranges into the 'YYYY-MM-DD' days that fall inside [from, to]. */
function expandRanges(ranges, from, to) {
  const out = new Set();
  for (const r of ranges) {
    const start = r.start > from ? r.start : from;
    const end = r.end < to ? r.end : to;
    // Noon UTC avoids DST/offset edge cases while stepping one day at a time
    for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.add(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

/** Set of 'YYYY-MM-DD' days in [from, to] covered by a scanner outage. Empty before migration 007. */
async function getOutageSet(from, to) {
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start, DATE_FORMAT(end_date, '%Y-%m-%d') AS end
       FROM scan_outages WHERE start_date <= ? AND end_date >= ?`,
      [to, from]
    );
    return expandRanges(rows, from, to);
  } catch (err) {
    console.warn('[scan_outages] unavailable:', err.message);
    return new Set();
  }
}

module.exports = { getHolidaySet, getOutageSet, expandRanges };
