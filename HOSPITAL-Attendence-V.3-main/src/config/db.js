const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool({
  ...dbConfig,
  database: process.env.DB_NAME_HOSPITAL
});

const hosofficePool = mysql.createPool({
  ...dbConfig,
  database: process.env.DB_NAME_HOSOFFICE
});

module.exports = {
  pool,
  hosofficePool,
  dbConfig // useful for tools that need to create connection without specific DB first
};
