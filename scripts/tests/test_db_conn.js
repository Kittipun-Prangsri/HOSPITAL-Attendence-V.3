require('dotenv').config();
const { pool } = require('../../src/config/db');

async function testConnection() {
  console.log(`Testing connection to ${process.env.DB_NAME_HOSPITAL}...`);
  try {
    const [rows] = await pool.execute('SELECT 1 as result');
    console.log('Query result:', rows);
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
