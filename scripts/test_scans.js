require('dotenv').config();
const { hosofficePool } = require('../src/config/db');

async function test() {
  try {
    const [rows] = await hosofficePool.query('SELECT * FROM hikvision ORDER BY AccessDate DESC, AccessTime DESC LIMIT 10');
    console.log('Last 10 Scans:');
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error('Database error:', err);
    process.exit(1);
  }
}

test();
