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

module.exports = { getHolidaySet };
