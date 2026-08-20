require('dotenv').config();
const { hosofficePool: conn } = require('../../src/config/db');

async function describeTable() {
  try {
    const [columns] = await conn.query('DESCRIBE hikvision');
    console.log('Hikvision Columns:');
    console.table(columns);
    
    const [sample] = await conn.query('SELECT * FROM hikvision LIMIT 1');
    console.log('Sample Data:');
    console.log(sample);
  } catch (err) {
    console.error(err);
  } finally {
    await conn.end();
  }
}
describeTable();
