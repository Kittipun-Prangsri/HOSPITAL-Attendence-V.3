require('dotenv').config();
const { hosofficePool } = require('../src/config/db');

async function run() {
  const tables = ['morning', 'afternoon', 'night'];
  for (const t of tables) {
    const tableName = `service_work_scans_8_${t}`;
    try {
      const [cols] = await hosofficePool.execute(`DESCRIBE ${tableName}`);
      const fields = cols.map(c => c.Field).filter(f => f.startsWith('d'));
      console.log(`${tableName} fields:`, fields.slice(0, 5), '...', fields.slice(-5));
    } catch (e) {
      console.log(`${tableName} error:`, e.message);
    }
  }
  process.exit();
}
run();
