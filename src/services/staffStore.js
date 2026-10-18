/**
 * Staff records without writing to HOSoffice.
 *
 * hospital_db.v_staff is a VIEW over hosoffice.hr_person (same server), so anything HR changes in
 * HOSoffice shows up immediately. Values this system edits live in hospital_db and win over HOSoffice:
 *   app_accounts   — USER_TYPE / HR_PASSWORD_HASH (and "account closed")
 *   staff_profiles — NICKNAME / HR_PHONE / HR_EMAIL / WORK_SHIFT / TIME_IN / TIME_OUT
 * A NULL override means "follow HOSoffice"; '' means "deliberately blank".
 * The view keeps hr_person's column names, so queries only swap `hr_person` for `${STAFF}`.
 */
const { pool, hosofficePool, STAFF } = require('../config/db');

const ACCOUNT_COLS = { USER_TYPE: 'role', HR_PASSWORD_HASH: 'password_hash' };
const PROFILE_COLS = { NICKNAME: 'nickname', HR_PHONE: 'phone', HR_EMAIL: 'email', WORK_SHIFT: 'work_shift', TIME_IN: 'time_in', TIME_OUT: 'time_out' };
// Never exposed through the view: links live in messaging_links, the rest are legacy LINE Notify tokens
const HIDDEN_COLS = new Set(['LINE_YOUR_USER_ID', 'TELEGRAM_CHAT_ID', 'LINE_TOKEN', 'LINE_TOKEN1', 'LINE_TOKEN2']);

/** SQL for the view, from the columns hr_person has on this server (pure, unit-tested). */
function buildViewSql({ hospitalDb, hosofficeDb, columns }) {
  const has = new Set(columns);
  const q = c => `\`${c}\``;
  const select = columns
    .filter(c => !HIDDEN_COLS.has(c) && !(c in ACCOUNT_COLS) && !(c in PROFILE_COLS))
    .map(c => `p.${q(c)}`);
  // HOSoffice tables are often tis620: convert so COALESCE never mixes collations
  const hos = c => (has.has(c) ? `CONVERT(p.${q(c)} USING utf8mb4) COLLATE utf8mb4_unicode_ci` : 'NULL');
  for (const [col, own] of Object.entries(ACCOUNT_COLS)) {
    select.push(`IF(a.disabled, NULL, COALESCE(a.${own}, ${hos(col)})) AS ${q(col)}`);
  }
  for (const [col, own] of Object.entries(PROFILE_COLS)) {
    select.push(`NULLIF(COALESCE(sp.${own}, ${hos(col)}), '') AS ${q(col)}`);
  }
  return `CREATE OR REPLACE SQL SECURITY DEFINER VIEW \`${hospitalDb}\`.v_staff AS
SELECT ${select.join(',\n       ')}
FROM \`${hosofficeDb}\`.hr_person p
LEFT JOIN \`${hospitalDb}\`.app_accounts a ON a.hr_person_id = p.ID
LEFT JOIN \`${hospitalDb}\`.staff_profiles sp ON sp.hr_person_id = p.ID`;
}

/** (Re)create the view — run by every `npm run migrate`, so new HOSoffice columns appear too. */
async function ensureStaffView() {
  const [cols] = await hosofficePool.query('SHOW COLUMNS FROM hr_person');
  await pool.query(buildViewSql({
    hospitalDb: process.env.DB_NAME_HOSPITAL,
    hosofficeDb: process.env.DB_NAME_HOSOFFICE,
    columns: cols.map(c => c.Field)
  }));
}

/** Set role and/or password hash (undefined = leave as is). Re-opens a closed account. */
async function saveAccount(personId, { role, passwordHash }, by) {
  await pool.query(
    `INSERT INTO app_accounts (hr_person_id, role, password_hash, disabled, updated_by) VALUES (?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE role = COALESCE(VALUES(role), role), password_hash = COALESCE(VALUES(password_hash), password_hash),
       disabled = 0, updated_by = VALUES(updated_by)`,
    [personId, role ?? null, passwordHash ?? null, by || null]);
}

/** Close the account: no login whatever HOSoffice says. */
async function closeAccount(personId, by) {
  await pool.query(
    `INSERT INTO app_accounts (hr_person_id, role, password_hash, disabled, updated_by) VALUES (?, NULL, NULL, 1, ?)
     ON DUPLICATE KEY UPDATE role = NULL, password_hash = NULL, disabled = 1, updated_by = VALUES(updated_by)`,
    [personId, by || null]);
}

/**
 * Which overrides to store (pure, unit-tested). A value equal to HOSoffice's is stored as NULL so the
 * field keeps following HOSoffice; a cleared field becomes ''.
 */
function profileOverrides(changes, hosRow) {
  const out = {};
  for (const [col, value] of Object.entries(changes)) {
    if (!(col in PROFILE_COLS) || value === undefined) continue;
    const mine = value == null ? '' : String(value).trim();
    const theirs = hosRow && hosRow[col] != null ? String(hosRow[col]).trim() : '';
    out[PROFILE_COLS[col]] = mine === theirs ? null : mine;
  }
  return out;
}

/** Save profile edits. changes: { NICKNAME: 'x', HR_PHONE: null, ... } (only keys present are touched). */
async function saveProfile(personId, changes, by) {
  const present = Object.keys(PROFILE_COLS).filter(c => changes[c] !== undefined);
  if (!present.length) return;
  let hosRow = {};
  const [hosCols] = await hosofficePool.query('SHOW COLUMNS FROM hr_person');
  const readable = present.filter(c => hosCols.some(h => h.Field === c));
  if (readable.length) {
    [[hosRow = {}]] = await hosofficePool.query(`SELECT ${readable.map(c => `\`${c}\``).join(', ')} FROM hr_person WHERE ID = ?`, [personId]);
  }
  const values = profileOverrides(changes, hosRow);
  const cols = Object.keys(values);
  await pool.query(
    `INSERT INTO staff_profiles (hr_person_id, ${cols.join(', ')}, updated_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON DUPLICATE KEY UPDATE ${cols.map(c => `${c} = VALUES(${c})`).join(', ')}, updated_by = VALUES(updated_by)`,
    [personId, ...cols.map(c => values[c]), by || null]);
}

module.exports = { STAFF, buildViewSql, ensureStaffView, saveAccount, closeAccount, saveProfile, profileOverrides, PROFILE_COLS, ACCOUNT_COLS };
