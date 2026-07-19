require('dotenv').config();
const { hosofficePool } = require('../../src/config/db');

async function checkSample() {
  try {
    const [rows] = await hosofficePool.query('SELECT hr_person_id, year_and_month FROM service_work_scans_8_morning LIMIT 5');
    console.table(rows);

    const [personnel] = await hosofficePool.query('SELECT ID, FINGLE_ID, HR_FNAME FROM hr_person LIMIT 5');
    console.table(personnel);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkSample();
