#!/usr/bin/env node
/** Manual backup: npm run backup  (the app also runs this every night at 03:00) */
require('dotenv').config();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Bangkok';
const { runBackup } = require('../src/services/dbBackup');
const { pool, hosofficePool } = require('../src/config/db');

(async () => {
  try {
    const { files, removed } = await runBackup();
    files.forEach(f => console.log(`✅ ${f.file} (${(f.bytes / 1024 / 1024).toFixed(2)} MB)`));
    if (removed) console.log(`🧹 removed ${removed} old backup file(s)`);
    process.exitCode = 0;
  } catch (err) {
    console.error('❌ backup failed:', err.message);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([pool.end(), hosofficePool.end()]);
  }
})();
