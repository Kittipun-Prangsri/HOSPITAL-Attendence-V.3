/**
 * LINE / Telegram account links (hospital_db.messaging_links) — the only source of truth.
 * HOSoffice hr_person.LINE_YOUR_USER_ID / TELEGRAM_CHAT_ID were imported once (migration 011)
 * and are no longer read or written.
 */
const { pool } = require('../config/db');

const FORMAT = { line: /^U[0-9a-f]{32}$/, telegram: /^-?\d{4,20}$/ };
const isValid = (channel, id) => Boolean(FORMAT[channel] && FORMAT[channel].test(String(id || '').trim()));

/** Map<hr_person_id(string), { line, telegram }> for the given people (all links when ids omitted). */
async function linksFor(personIds) {
  const ids = personIds ? [...new Set(personIds.map(String))].filter(Boolean) : null;
  const map = new Map();
  if (ids && !ids.length) return map;
  const [rows] = await pool.query(
    `SELECT hr_person_id, channel, external_id FROM messaging_links${ids ? ' WHERE hr_person_id IN (?)' : ''}`, ids ? [ids] : []);
  for (const r of rows) {
    const k = String(r.hr_person_id);
    if (!map.has(k)) map.set(k, { line: null, telegram: null });
    map.get(k)[r.channel] = r.external_id;
  }
  return map;
}

/** { line, telegram } for one person (nulls when not linked). */
async function linkOf(personId) {
  return (await linksFor([personId])).get(String(personId)) || { line: null, telegram: null };
}

/** hr_person_id linked to this LINE user id / Telegram chat id, or null. */
async function personByExternal(channel, externalId) {
  if (!isValid(channel, externalId)) return null;
  const [[row]] = await pool.query('SELECT hr_person_id FROM messaging_links WHERE channel = ? AND external_id = ?', [channel, String(externalId).trim()]);
  return row ? row.hr_person_id : null;
}

/** For a chat user id that may be LINE (U…) or Telegram (digits). */
async function personByChatId(chatId) {
  const id = String(chatId || '').trim();
  return personByExternal(/^U/.test(id) ? 'line' : 'telegram', id);
}

/**
 * Link (or relink) a person's account. Throws { code: 'TAKEN' } when the account already belongs to
 * someone else. Resolves to { previous } — the account it replaced, if any (so the old one can be told).
 */
async function setLink({ personId, channel, externalId, via, by }) {
  const id = String(externalId || '').trim();
  if (!isValid(channel, id)) throw Object.assign(new Error('รูปแบบไอดีไม่ถูกต้อง'), { code: 'FORMAT' });
  const owner = await personByExternal(channel, id);
  if (owner && String(owner) !== String(personId)) throw Object.assign(new Error('บัญชีนี้ผูกกับบุคลากรคนอื่นอยู่แล้ว'), { code: 'TAKEN' });
  const [[current]] = await pool.query('SELECT external_id FROM messaging_links WHERE hr_person_id = ? AND channel = ?', [personId, channel]);
  await pool.query(
    `INSERT INTO messaging_links (hr_person_id, channel, external_id, linked_via, linked_by) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE external_id = VALUES(external_id), linked_via = VALUES(linked_via), linked_by = VALUES(linked_by), linked_at = CURRENT_TIMESTAMP`,
    [personId, channel, id, via, by || null]);
  if (channel === 'telegram') await require('./deadLinks').resolve(personId);
  return { previous: current && current.external_id !== id ? current.external_id : null };
}

async function removeLink({ personId, channel }) {
  const [r] = await pool.query('DELETE FROM messaging_links WHERE hr_person_id = ? AND channel = ?', [personId, channel]);
  return r.affectedRows > 0;
}

/**
 * Apply a form value: undefined → leave as is, '' / null → unlink, anything else → (re)link.
 * Resolves to { changed, previous }. Throws FORMAT / TAKEN errors from setLink.
 */
async function applyLinkInput({ personId, channel, value, via, by }) {
  if (value === undefined) return { changed: false, previous: null };
  const v = value == null ? '' : String(value).trim();
  if (!v) return { changed: await removeLink({ personId, channel }), previous: null };
  const r = await setLink({ personId, channel, externalId: v, via, by });
  return { changed: true, previous: r.previous };
}

/** Attach line_user_id / telegram_chat_id to rows that have an hr_person id column. */
async function attachLinks(rows, idKey = 'ID') {
  const links = await linksFor(rows.map(r => r[idKey]));
  rows.forEach(r => {
    const l = links.get(String(r[idKey])) || {};
    r.line_user_id = l.line || null;
    r.telegram_chat_id = l.telegram || null;
  });
  return rows;
}

module.exports = { linksFor, linkOf, personByExternal, personByChatId, setLink, removeLink, applyLinkInput, attachLinks, isValid };
