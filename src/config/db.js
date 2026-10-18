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

// Hospital MySQL servers are often set up with character-set-server=tis620 plus
// skip-character-set-client-handshake or init_connect='SET NAMES tis620'. Then the server ignores the
// utf8mb4 we ask for at handshake and reads our UTF-8 bytes as TIS-620, so every Thai string we write
// turns into "เน�เธ�…". An explicit SET NAMES on each new connection is always honoured.
const SET_NAMES = 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci';
function forceUtf8mb4(p) {
  p.on('connection', conn => conn.query(SET_NAMES)); // core connection: queued ahead of the first real query
  return p;
}
forceUtf8mb4(pool);
forceUtf8mb4(hosofficePool);

// hospital_db.v_staff: hosoffice.hr_person plus this system's own overrides (see services/staffStore.js).
// Fully qualified so hosofficePool queries can still JOIN HOSoffice tables (both DBs share one server).
const STAFF = `\`${process.env.DB_NAME_HOSPITAL}\`.v_staff`;

module.exports = {
  pool,
  hosofficePool,
  STAFF,
  forceUtf8mb4,
  dbConfig // useful for tools that need to create connection without specific DB first
};
