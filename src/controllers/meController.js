const { hosofficePool } = require('../config/db');
const { myMonth } = require('../services/myMonth');
const { linkOf, removeLink } = require('../services/messagingLinks');
const { createToken } = require('../services/telegramLink');
const { logAudit } = require('../utils/audit');

/** GET /api/me/month?ym=YYYY-MM — the signed-in person's month (current and up to 5 months back). */
exports.month = async (req, res) => {
  const now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.ym || '') ? req.query.ym : now;
  const [ny, nm] = now.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  const back = (ny - y) * 12 + (nm - m);
  if (back < 0 || back > 5) return res.status(400).json({ success: false, error: 'ดูได้เฉพาะเดือนนี้และย้อนหลัง 5 เดือน' });
  try {
    const [[p]] = await hosofficePool.query('SELECT ID AS id, FINGLE_ID AS fingle_id, HR_CID AS cid FROM hr_person WHERE ID = ?', [req.session.user.id]);
    if (!p || !p.fingle_id) return res.status(400).json({ success: false, error: 'ไม่พบรหัสเครื่องสแกนของท่าน' });
    res.json({ success: true, ...(await myMonth({ person: p, ym })), canPrev: back < 5, canNext: back > 0 });
  } catch (err) {
    console.error('[me] month failed:', err);
    res.status(500).json({ success: false, error: 'โหลดข้อมูลเดือนนี้ไม่สำเร็จ' });
  }
};

/** GET /api/me/links — which accounts the signed-in person has linked (ids partly masked). */
exports.links = async (req, res) => {
  try {
    const l = await linkOf(req.session.user.id);
    const mask = v => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null);
    res.json({ success: true, line: mask(l.line), telegram: mask(l.telegram), telegramReady: Boolean(process.env.TELEGRAM_BOT_TOKEN) });
  } catch (err) {
    console.error('[me] links failed:', err);
    res.status(500).json({ success: false, error: 'โหลดข้อมูลไม่สำเร็จ' });
  }
};

/** POST /api/me/links/telegram — one-time t.me deep link (valid 10 minutes). */
exports.telegramLink = async (req, res) => {
  const NotificationService = require('../services/notificationService');
  const bot = await NotificationService.telegramBotUsername();
  if (!bot) return res.status(503).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Telegram bot' });
  const token = createToken(req.session.user.id, req.session.user.fullname);
  res.json({ success: true, url: `https://t.me/${bot}?start=link_${token}`, expiresIn: 600 });
};

/** DELETE /api/me/links/:channel — unlink my own LINE or Telegram. */
exports.unlink = async (req, res) => {
  const channel = req.params.channel;
  if (!['line', 'telegram'].includes(channel)) return res.status(400).json({ success: false, error: 'ช่องทางไม่ถูกต้อง' });
  try {
    const removed = await removeLink({ personId: req.session.user.id, channel });
    if (removed) logAudit(req, 'unlink', channel, req.session.user.id, { via: 'self' });
    res.json({ success: true, message: `ยกเลิกการเชื่อม ${channel === 'line' ? 'LINE' : 'Telegram'} แล้ว` });
  } catch (err) {
    console.error('[me] unlink failed:', err);
    res.status(500).json({ success: false, error: 'ยกเลิกไม่สำเร็จ' });
  }
};
