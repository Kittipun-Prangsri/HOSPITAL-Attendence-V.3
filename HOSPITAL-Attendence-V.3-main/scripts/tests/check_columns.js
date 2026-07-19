require('dotenv').config();
const { hosofficePool } = require('../../src/config/db');

async function checkColumns() {
  try {
    const [desc] = await hosofficePool.query('DESCRIBE service_work_scans_8_morning');
    console.table(desc.map(d => ({ Field: d.Field, Type: d.Type })));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkColumns();
