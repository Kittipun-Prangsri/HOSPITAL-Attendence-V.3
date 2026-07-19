require('dotenv').config();
const { hosofficePool } = require('../src/config/db');

async function run() {
  try {
    const tablesToCheck = [
      'service_work_scans_8_morning',
      'service_work_scans_8_afternoon',
      'service_work_scans_8_night'
    ];

    for (const table of tablesToCheck) {
      console.log(`\n--- Checking Table: ${table} ---`);
      try {
        const [rows] = await hosofficePool.execute(`SHOW TABLES LIKE '${table}'`);
        if (rows.length > 0) {
          const [desc] = await hosofficePool.execute(`DESCRIBE ${table}`);
          console.table(desc.map(d => ({ Field: d.Field, Type: d.Type })).slice(0, 10)); // Top 10 columns
          
          const [sample] = await hosofficePool.execute(`SELECT * FROM ${table} LIMIT 1`);
          console.log(`Sample data found:`, sample.length > 0 ? "YES" : "NO");
        } else {
          console.log(`Table ${table} does not exist.`);
        }
      } catch (err) {
        console.error(`Error checking table ${table}:`, err.message);
      }
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit();
  }
}

run();
