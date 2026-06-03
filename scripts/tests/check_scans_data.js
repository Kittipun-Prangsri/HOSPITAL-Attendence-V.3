require('dotenv').config();
const { hosofficePool } = require('../../src/config/db');

async function check() {
  try {
    console.log('Checking hr_person_hiling_time table...');
    const [counts] = await hosofficePool.query('SELECT TEMPLATE_ID, COUNT(*) as count FROM hr_person_hiling_time GROUP BY TEMPLATE_ID');
    console.table(counts);

    console.log('\nChecking service_work_scans tables...');
    const tables = [
      'service_work_scans_morning',
      'service_work_scans_afternoon',
      'service_work_scans_8_morning',
      'service_work_scans_8_afternoon'
    ];
    for (const t of tables) {
      const [rows] = await hosofficePool.query(`SHOW TABLES LIKE '${t}'`);
      if (rows.length > 0) {
        const [data] = await hosofficePool.query(`SELECT COUNT(*) as count FROM ${t}`);
        console.log(`${t}: ${data[0].count} rows`);
      } else {
        console.log(`${t}: DOES NOT EXIST`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
