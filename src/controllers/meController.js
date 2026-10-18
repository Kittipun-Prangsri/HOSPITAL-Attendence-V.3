const { hosofficePool, STAFF } = require('../config/db');
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
    const [[p]] = await hosofficePool.query(`SELECT ID AS id, FINGLE_ID AS fingle_id, HR_CID AS cid FROM ${STAFF} WHERE ID = ?`, [req.session.user.id]);
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
    require('../services/mfa').clearSetupCache(req.session.user.id);
    if (removed) logAudit(req, 'unlink', channel, req.session.user.id, { via: 'self' });
    res.json({ success: true, message: `ยกเลิกการเชื่อม ${channel === 'line' ? 'LINE' : 'Telegram'} แล้ว` });
  } catch (err) {
    console.error('[me] unlink failed:', err);
    res.status(500).json({ success: false, error: 'ยกเลิกไม่สำเร็จ' });
  }
};

/* ---------------- Two-step sign-in (security page) ---------------- */
const mfa = require('../services/mfa');

exports.mfaStatus = async (req, res) => {
  try {
    const st = await mfa.status(req.session.user.id);
    res.json({ success: true, ...st, required: mfa.enforcedFor(req.session.user.role), telegramReady: Boolean(process.env.TELEGRAM_BOT_TOKEN) });
  } catch (err) {
    console.error('[mfa] status failed:', err);
    res.status(500).json({ success: false, error: 'โหลดข้อมูลไม่สำเร็จ (ตรวจสอบว่ารัน npm run migrate แล้ว)' });
  }
};

exports.mfaSetup = async (req, res) => {
  try {
    const u = req.session.user;
    const { secret, qr } = await mfa.beginTotpSetup(u.id, u.username || String(u.id));
    res.json({ success: true, secret, qr });
  } catch (err) {
    console.error('[mfa] setup failed:', err);
    res.status(500).json({ success: false, error: 'เริ่มตั้งค่าไม่สำเร็จ' });
  }
};

exports.mfaConfirm = async (req, res) => {
  const r = await mfa.confirmTotp(req.session.user.id, (req.body || {}).code).catch(err => ({ error: err.message }));
  if (r.error) return res.status(400).json({ success: false, error: r.error });
  mfa.clearSetupCache(req.session.user.id);
  logAudit(req, 'mfa_enable', 'auth', req.session.user.id, { method: 'totp' });
  res.json({ success: true, codes: r.codes, message: 'เปิดใช้แอป Authenticator แล้ว' });
};

/** Sensitive changes need a current authenticator or recovery code. */
async function proveFactor(req) {
  const code = String((req.body || {}).code || '').trim();
  const id = req.session.user.id;
  return (/^\d{6}$/.test(code) && await mfa.verifyTotpFor(id, code)) || (/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(code) && await mfa.useRecovery(id, code));
}

exports.mfaDisable = async (req, res) => {
  if (!await proveFactor(req)) return res.status(400).json({ success: false, error: 'รหัสยืนยันไม่ถูกต้อง' });
  await mfa.disableTotp(req.session.user.id);
  mfa.clearSetupCache(req.session.user.id);
  logAudit(req, 'mfa_disable', 'auth', req.session.user.id, { method: 'totp' });
  res.json({ success: true, message: 'ปิดการใช้แอป Authenticator แล้ว' });
};

exports.mfaRecovery = async (req, res) => {
  if (!await proveFactor(req)) return res.status(400).json({ success: false, error: 'รหัสยืนยันไม่ถูกต้อง' });
  const codes = await mfa.regenerateRecovery(req.session.user.id);
  logAudit(req, 'mfa_recovery_regenerated', 'auth', req.session.user.id);
  res.json({ success: true, codes });
};
