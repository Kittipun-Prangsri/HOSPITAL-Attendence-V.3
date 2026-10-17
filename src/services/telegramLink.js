/**
 * Link a Telegram chat without copying ids: a signed-in user asks for a one-time deep link
 * (t.me/<bot>?start=link_<token>, valid 10 minutes); pressing Start sends "/start link_<token>"
 * to the bot, which links that private chat to the person.
 */
const crypto = require('crypto');
const { setLink } = require('./messagingLinks');

const TTL_MS = 10 * 60 * 1000;
const tokens = new Map(); // token → { personId, fullname, exp }

function createToken(personId, fullname) {
  for (const [k, v] of tokens) if (v.exp < Date.now()) tokens.delete(k);
  const token = crypto.randomBytes(18).toString('base64url'); // 24 chars, Telegram allows A-Za-z0-9_-
  tokens.set(token, { personId, fullname, exp: Date.now() + TTL_MS });
  return token;
}

/**
 * Handle "/start link_<token>" from a chat. Resolves to the reply text, or null if the message is
 * not a link request. Only private chats can be linked (a group would leak personal messages).
 */
async function handleStart(text, chat) {
  const m = /^\/start\s+link_([A-Za-z0-9_-]{16,40})$/.exec(String(text || '').trim());
  if (!m) return null;
  const entry = tokens.get(m[1]);
  tokens.delete(m[1]); // single use
  if (!entry || entry.exp < Date.now()) return 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณากด "เชื่อม Telegram" ในระบบอีกครั้ง';
  if (!chat || chat.type !== 'private') return 'เชื่อมได้เฉพาะแชตส่วนตัวกับบอทเท่านั้น';
  try {
    const { previous } = await setLink({ personId: entry.personId, channel: 'telegram', externalId: String(chat.id), via: 'telegram_start', by: entry.fullname });
    // No HTTP request here: audit with an empty request and the person as actor
    await require('../utils/audit').logAudit({ headers: {}, socket: {} }, previous ? 'relink' : 'link', 'telegram', entry.personId,
      { via: 'telegram_start' }, { username: null, fullname: entry.fullname, role: null });
    return `✅ เชื่อม Telegram กับบัญชี KHH HRM ของคุณ${entry.fullname}เรียบร้อยแล้ว\nต่อไปจะได้รับการแจ้งเตือนการสแกนและผลการอนุมัติที่นี่`;
  } catch (err) {
    if (err.code === 'TAKEN') return 'แชต Telegram นี้ผูกกับบุคลากรคนอื่นอยู่แล้ว กรุณาติดต่อ HR';
    console.error('[TelegramLink] failed:', err.message);
    return 'เชื่อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }
}

function _reset() { tokens.clear(); }

module.exports = { createToken, handleStart, TTL_MS, _reset };
