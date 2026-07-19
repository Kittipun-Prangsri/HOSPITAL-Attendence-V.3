require('dotenv').config();
const { hosofficePool } = require('../../src/config/db');

async function checkMonths() {
  try {
    const [rows] = await hosofficePool.query('SELECT DISTINCT year_and_month FROM service_work_scans_8_morning ORDER BY year_and_month DESC');
    console.table(rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkMonths();
