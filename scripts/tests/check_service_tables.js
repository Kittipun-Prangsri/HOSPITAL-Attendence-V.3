require('dotenv').config();
const { hosofficePool: conn } = require('../../src/config/db');

async function describeServiceTables() {
  try {
    const [colsMorning] = await conn.query('DESCRIBE service_work_scans_morning');
    console.log('Morning Table Columns:');
    console.table(colsMorning);
    
    const [colsAfternoon] = await conn.query('DESCRIBE service_work_scans_afternoon');
    console.log('Afternoon Table Columns:');
    console.table(colsAfternoon);

    const [sample] = await conn.query('SELECT * FROM service_work_scans_morning LIMIT 1');
    console.log('Sample Data (Morning):');
    console.log(sample);
  } catch (err) {
    console.error(err);
  } finally {
    await conn.end();
  }
}
describeServiceTables();
