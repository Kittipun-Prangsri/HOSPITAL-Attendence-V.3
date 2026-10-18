/**
 * Telegram chats that can never receive messages ("chat not found", bot blocked, account deleted).
 * Every scan card to such a chat fails and eats into the bot's rate limit. After THRESHOLD permanent
 * failures in a row the link is removed, logged (audit_log + messaging_unlinked for the admin list) and
 * the person is told once over LINE — if they have LINE linked — how to relink in a minute.
 * Temporary errors (429, 5xx, network) never count; any successful send resets the counter.
 */
const { pool } = require('../config/db');
const { logAudit } = require('../utils/audit');

const THRESHOLD = 3;
const PERMANENT = /chat not found|bot was blocked by the user|user is deactivated|bot can't initiate conversation|chat_id is empty|PEER_ID_INVALID/i;
const SYSTEM = { username: 'system', fullname: 'ระบบ (ส่ง Telegram ไม่ถึง)', role: 'system' };

const isPermanent = err => Boolean(err && PERMANENT.test(String(err.message || err)));

function relinkMessage(liffId) {
  const how = liffId
    ? `เชื่อมใหม่ได้เองใน 1 นาที:\n1) เปิด https://liff.line.me/${liffId}\n2) ที่การ์ด "ช่องทางแจ้งเตือน" กด "เชื่อม" ข้าง Telegram\n3) กด Start ในแอป Telegram`
    : 'ติดต่อผู้ดูแลระบบเพื่อเชื่อม Telegram ใหม่';
  return `🔔 KHH HRM: ระบบส่งการ์ดสแกนทาง Telegram ถึงคุณไม่ได้ (ไม่พบแชต หรือบอทถูกบล็อก) จึงยกเลิกการเชื่อม Telegram เดิมแล้ว\n\n${how}`;
}

/** Tell the person over LINE once (important message). Resolves to true when sent. */
async function notifyOverLine(personId, unlinkedId) {
  const { linkOf } = require('./messagingLinks');
  const { line } = await linkOf(personId);
  if (!line) return false;
  const sent = await require('./notificationService').sendDirectLine(line, relinkMessage((process.env.LIFF_ID || '').trim()));
  if (sent) await pool.query('UPDATE messaging_unlinked SET line_notified_at = NOW() WHERE id = ?', [unlinkedId]);
  return sent;
}

async function unlink(link, reason) {
  const conn = await pool.getConnection();
  let unlinkedId;
  try {
    await conn.beginTransaction();
    // Only if it is still the same chat (the person may have just relinked)
    const [del] = await conn.query("DELETE FROM messaging_links WHERE hr_person_id = ? AND channel = 'telegram' AND external_id = ?", [link.hr_person_id, link.external_id]);
    if (!del.affectedRows) { await conn.rollback(); return null; }
    const [ins] = await conn.query(
      "INSERT INTO messaging_unlinked (hr_person_id, channel, external_id, linked_via, reason) VALUES (?, 'telegram', ?, ?, ?)",
      [link.hr_person_id, link.external_id, link.linked_via, String(reason).slice(0, 255)]);
    unlinkedId = ins.insertId;
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  await logAudit({ headers: {} }, 'unlink', 'messaging_link', link.hr_person_id,
    { channel: 'telegram', reason, failures: THRESHOLD, linkedVia: link.linked_via }, SYSTEM);
  console.warn(`[deadLinks] Telegram link of person ${link.hr_person_id} removed after ${THRESHOLD} failures: ${reason}`);
  const lineNotified = await notifyOverLine(link.hr_person_id, unlinkedId).catch(err => {
    console.warn('[deadLinks] LINE notice failed:', err.message);
    return false;
  });
  return { unlinkedId, lineNotified };
}

/**
 * Record the outcome of one send to a Telegram chat (err = null on success).
 * Chats that are not a staff link (e.g. the admin group) are ignored. Resolves to the unlink result
 * when this failure removed the link, else null.
 */
async function recordTelegram(chatId, err) {
  const id = String(chatId || '').trim();
  if (!id) return null;
  if (!err) {
    await pool.query("UPDATE messaging_links SET fail_count = 0, last_error = NULL WHERE channel = 'telegram' AND external_id = ? AND fail_count > 0", [id]);
    return null;
  }
  if (!isPermanent(err)) return null;
  const reason = String(err.message || err).slice(0, 255);
  await pool.query(
    "UPDATE messaging_links SET fail_count = fail_count + 1, last_error = ?, last_failed_at = NOW() WHERE channel = 'telegram' AND external_id = ?",
    [reason, id]);
  const [[link]] = await pool.query(
    "SELECT hr_person_id, external_id, linked_via, fail_count FROM messaging_links WHERE channel = 'telegram' AND external_id = ?", [id]);
  if (!link || link.fail_count < THRESHOLD) return null;
  return unlink(link, reason);
}

/** Never let bookkeeping break a send. */
function safeRecordTelegram(chatId, err) {
  return recordTelegram(chatId, err).catch(e => { console.warn('[deadLinks] not recorded:', e.message); return null; });
}

/** Open cases for the admin page: people whose Telegram was removed and have not relinked yet. */
async function openCases() {
  const [rows] = await pool.query(
    `SELECT u.id, u.hr_person_id, u.reason, u.linked_via, u.unlinked_at, u.line_notified_at
     FROM messaging_unlinked u
     WHERE u.channel = 'telegram' AND u.resolved_at IS NULL
     ORDER BY u.unlinked_at DESC LIMIT 200`);
  return rows;
}

/** Called when a person links Telegram again. */
async function resolve(personId) {
  await pool.query("UPDATE messaging_unlinked SET resolved_at = NOW() WHERE hr_person_id = ? AND channel = 'telegram' AND resolved_at IS NULL", [personId]);
}

module.exports = { THRESHOLD, isPermanent, relinkMessage, recordTelegram, safeRecordTelegram, openCases, resolve };
