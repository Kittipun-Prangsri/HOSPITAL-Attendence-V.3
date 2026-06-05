const mysql = require('mysql2/promise');

async function testConnection() {
  const config = {
    host: '192.168.80.7',
    user: 'Khos',
    password: 'KH10866@zjkowfh',
    database: 'hospital_db',
    connectTimeout: 10000, // 10 seconds
    charset: 'utf8mb4'
  };

  console.log('Testing connection to 192.168.80.7 (hospital_db)...');
  try {
    const connection = await mysql.createConnection(config);
    console.log('Successfully connected to hospital_db database!');
    const [rows] = await connection.execute('SELECT 1 as result');
    console.log('Query result:', rows);
    await connection.end();
  } catch (err) {
    console.error('Connection to hospital_db failed:', err);
  }
}

testConnection();
