const mysql = require('mysql2/promise');
const dbConfig = { host: '192.168.80.7', user: 'Khos', password: 'KH10866@zjkowfh', database: 'hosoffice', charset: 'utf8mb4' };

async function describeTable() {
  const conn = await mysql.createConnection(dbConfig);
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
