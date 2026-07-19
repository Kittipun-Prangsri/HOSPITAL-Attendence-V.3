require('dotenv').config();
const mysql = require('mysql2/promise');

async function rotatePassword() {
  const newPassword = process.env.NEW_DB_PASSWORD;
  if (!newPassword || newPassword.length < 24) {
    throw new Error('NEW_DB_PASSWORD must be at least 24 characters long');
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  try {
    const [rows] = await connection.query('SELECT CURRENT_USER() AS active_user');
    const [username, host] = String(rows[0].active_user).split('@');
    if (!/^[A-Za-z0-9_.$-]+$/.test(username) || !/^[A-Za-z0-9_.%:-]+$/.test(host)) {
      throw new Error('Unexpected MySQL account format');
    }
    await connection.query(`ALTER USER '${username}'@'${host}' IDENTIFIED BY ${connection.escape(newPassword)}`);
    console.log(`Password rotated for ${username}@${host}.`);
  } finally {
    await connection.end();
  }
}

rotatePassword()
  .then(() => process.exit(0))
  .catch(error => { console.error(`[rotate-db-password] ${error.message}`); process.exit(1); });
