/**
 * Nightly logical backup of the app database (and optionally chosen HOSoffice tables) to gzip SQL.
 * Pure Node — no mysqldump needed on the Windows server. Restore: gunzip, then run the .sql in
 * Navicat ("Execute SQL File") or `mysql -u USER -p DBNAME < file.sql`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'backups');
const NAME_RE = /^(.+)-(\d{8}-\d{4})\.sql\.gz$/;
// Session rows are throw-away (and contain live login state): keep the table definition only
const SCHEMA_ONLY = new Set(['sessions']);
const BATCH = 200;

const stamp = now => {
  const p = n => String(n).padStart(2, '0');
  const d = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** JSON columns come back as objects and would be formatted as "a = b"; store them as JSON text. */
const normalise = row => row.map(v => (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v));

async function* dumpLines(pool, dbName, tables) {
  const conn = await pool.getConnection();
  try {
    yield `-- KHH HRM backup of \`${dbName}\` · ${new Date().toISOString()}\n`;
    yield 'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\n\n';
    const [all] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const names = all.map(r => Object.values(r)[0]).filter(t => !tables || tables.includes(t));
    for (const t of names) {
      const [[create]] = await conn.query('SHOW CREATE TABLE ??', [t]);
      yield `DROP TABLE IF EXISTS \`${t}\`;\n${create['Create Table']};\n\n`;
      if (SCHEMA_ONLY.has(t)) continue;
      // Stream rows so a large table (e.g. hikvision) never sits in memory
      const stream = conn.connection.query({ sql: 'SELECT * FROM ??', values: [t], rowsAsArray: true }).stream({ highWaterMark: BATCH });
      let batch = [];
      for await (const row of stream) {
        batch.push(normalise(row));
        if (batch.length >= BATCH) { yield conn.format('INSERT INTO ?? VALUES ?;\n', [t, batch]); batch = []; }
      }
      if (batch.length) yield conn.format('INSERT INTO ?? VALUES ?;\n', [t, batch]);
      yield '\n';
    }
    yield 'SET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n';
  } finally {
    conn.release();
  }
}

/** Write one gzip file atomically (tmp → rename). Resolves to { file, bytes }. */
async function backupOne(pool, dbName, { dir, label, tables, now }) {
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${label}-${stamp(now)}.sql.gz`);
  const tmp = `${file}.part`;
  try {
    await pipeline(Readable.from(dumpLines(pool, dbName, tables)), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
  return { file, bytes: (await fs.promises.stat(file)).size };
}

/** Delete backups older than keepDays (only files this module created). */
async function prune(dir, keepDays, now = new Date()) {
  const cutoff = now.getTime() - keepDays * 86400000;
  let removed = 0;
  for (const name of await fs.promises.readdir(dir).catch(() => [])) {
    if (!NAME_RE.test(name)) continue;
    const p = path.join(dir, name);
    if ((await fs.promises.stat(p)).mtimeMs < cutoff) { await fs.promises.unlink(p); removed++; }
  }
  return removed;
}

/**
 * Back up the app DB, plus HOSoffice tables listed in BACKUP_HOSOFFICE_TABLES (comma separated),
 * then prune. Resolves to { files: [{ file, bytes }], removed }.
 */
async function runBackup({ now = new Date(), dir = process.env.BACKUP_DIR || DEFAULT_DIR, keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 14 } = {}) {
  const { pool, hosofficePool } = require('../config/db');
  const files = [];
  const hospitalDb = process.env.DB_NAME_HOSPITAL;
  files.push(await backupOne(pool, hospitalDb, { dir, label: hospitalDb, now }));
  const extra = String(process.env.BACKUP_HOSOFFICE_TABLES || '').split(',').map(s => s.trim()).filter(t => /^[A-Za-z0-9_]+$/.test(t));
  if (extra.length) {
    files.push(await backupOne(hosofficePool, process.env.DB_NAME_HOSOFFICE, { dir, label: `${process.env.DB_NAME_HOSOFFICE}-tables`, tables: extra, now }));
  }
  const removed = await prune(dir, keepDays, now);
  return { files, removed };
}

/** Newest backup file for the status panel. */
async function latestBackup(dir = process.env.BACKUP_DIR || DEFAULT_DIR) {
  const names = (await fs.promises.readdir(dir).catch(() => [])).filter(n => NAME_RE.test(n));
  if (!names.length) return null;
  const stats = await Promise.all(names.map(async n => ({ name: n, ...(await fs.promises.stat(path.join(dir, n))) })));
  const newest = stats.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return { name: newest.name, bytes: newest.size, at: newest.mtime, count: names.length };
}

module.exports = { runBackup, backupOne, prune, latestBackup, DEFAULT_DIR };
