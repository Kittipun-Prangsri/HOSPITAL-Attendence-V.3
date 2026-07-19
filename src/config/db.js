const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: process.env.DB_TIMEZONE || '+07:00',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 seconds delay before keep-alive probes
  connectTimeout: 10000,        // 10 seconds to establish connection
  idleTimeout: 60000            // 60 seconds idle timeout to reap stale connections
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
