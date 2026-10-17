/**
 * Pings both databases every few minutes and alerts admins (Telegram/LINE, which do not depend on the
 * database) after two failures in a row, then once more when the connection is back.
 */
const { pool, hosofficePool } = require('../config/db');

const FAILS_BEFORE_ALERT = 2;
const state = { hospital: { fails: 0, down: false }, hosoffice: { fails: 0, down: false } };

const ping = (p, ms = 5000) => Promise.race([
  p.query('SELECT 1'),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))
]);

async function check({ notify } = {}) {
  const send = notify || (msg => require('./notificationService').sendToAdmin(msg));
  const label = { hospital: 'ฐานข้อมูลระบบ (hospital_db)', hosoffice: 'ฐานข้อมูล HOSoffice' };
  for (const [key, p] of [['hospital', pool], ['hosoffice', hosofficePool]]) {
    const s = state[key];
    try {
      await ping(p);
      if (s.down) await send(`✅ ${label[key]} กลับมาเชื่อมต่อได้แล้ว`);
      s.fails = 0; s.down = false;
    } catch (err) {
      s.fails += 1;
      if (!s.down && s.fails >= FAILS_BEFORE_ALERT) {
        s.down = true;
        await send(`🚨 ระบบลงเวลาเชื่อมต่อ${label[key]}ไม่ได้\n${err.message}\nผู้ใช้จะเข้าระบบและดูรายงานไม่ได้จนกว่าจะแก้ไข`);
      }
    }
  }
  return JSON.parse(JSON.stringify(state));
}

function _reset() { for (const k of Object.keys(state)) state[k] = { fails: 0, down: false }; }

module.exports = { check, _reset };
