const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/audit');
const { safeReturnTo } = require('../middleware/auth');
const { hosofficePool } = require('../config/db');
const mfa = require('../services/mfa');

const PENDING_TTL_MS = 10 * 60 * 1000;

/** Send a fresh Telegram sign-in code to the person's linked chat; stores only its hash in the session. */
async function sendTelegramCode(req, personId) {
  const { linkOf } = require('../services/messagingLinks');
  const chat = (await linkOf(personId)).telegram;
  if (!chat) return false;
  const t = mfa.newTelegramCode();
  req.session.mfaPending.tg = { hash: t.hash, exp: t.exp, sentAt: Date.now() };
  const NotificationService = require('../services/notificationService');
  return NotificationService.sendDirectTelegram(chat,
    `🔐 รหัสเข้าสู่ระบบ KHH HRM: ${t.code}\nใช้ได้ 5 นาที · ถ้าไม่ได้เข้าสู่ระบบเอง กรุณาเปลี่ยนรหัสผ่านทันที`);
}

function finishLogin(req, res, user, returnTo, detail) {
  req.session.regenerate(err => {
    if (err) return res.render('login', { error: 'เกิดข้อผิดพลาดในการสร้างเซสชัน' });
    req.session.user = user;
    logAudit(req, 'login', 'auth', user.id, detail || null, user);
    req.session.save(saveErr => {
      if (saveErr) return res.render('login', { error: 'เกิดข้อผิดพลาดในการบันทึกเซสชัน' });
      res.redirect(returnTo);
    });
  });
}

exports.getLogin = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
  const { username, password } = req.body;
  console.log(`[Auth] Login attempt for username: ${username}`);
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 50 || password.length > 200) {
    return res.status(400).render('login', { error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }
  try {
    const [rows] = await hosofficePool.query(
      'SELECT ID as id, HR_CID as cid, FINGLE_ID as fingle_id, CONCAT(HR_FNAME, \' \', HR_LNAME) as fullname, USER_TYPE as role, HR_PASSWORD_HASH as password_hash FROM hr_person WHERE HR_CID = ? OR FINGLE_ID = ?',
      [username, username]
    );

    if (rows.length > 0) {
      const user = rows[0];
      const roleLower = user.role ? user.role.toLowerCase() : 'user';

      const isMatch = Boolean(user.password_hash) && await bcrypt.compare(password, user.password_hash);

      if (isMatch) {
        console.log(`[Auth] Login successful for ${username} (${user.fullname})`);
        // New session id on login (prevents session fixation); CSRF token is re-issued with it
        const returnTo = safeReturnTo(req.session.returnTo) || '/';
        const sessionUser = { id: user.id, username: user.fingle_id || user.cid, fullname: user.fullname, role: roleLower };
        const st = await mfa.status(user.id);
        const enforced = mfa.enforcedFor(roleLower);
        if ((enforced || st.totp) && (st.totp || st.telegram)) {
          // Password was right: hold the login until the second step succeeds
          return req.session.regenerate(async regenErr => {
            if (regenErr) return res.render('login', { error: 'เกิดข้อผิดพลาดในการสร้างเซสชัน' });
            req.session.mfaPending = { user: sessionUser, returnTo, at: Date.now(), attempts: 0, tg: null };
            if (!st.totp) await sendTelegramCode(req, user.id).catch(() => false);
            req.session.save(() => res.redirect('/login/mfa'));
          });
        }
        if (enforced) {
          // Admin without any second factor yet: allowed in, but every page leads to the setup screen
          return finishLogin(req, res, { ...sessionUser }, '/security', { mfa: 'setup_required' });
        }
        return finishLogin(req, res, sessionUser, returnTo);
      } else {
        console.log(`[Auth] Password mismatch for ${username}`);
      }
    } else {
      console.log(`[Auth] User not found: ${username}`);
    }
    logAudit(req, 'login_failed', 'auth', null, { username: String(username).slice(0, 50) }, { username: null, fullname: null, role: null });
    res.render('login', { error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.render('login', { error: 'เกิดข้อผิดพลาดของระบบ' });
  }
};

/* ---------------- Second step ---------------- */

function pendingOf(req) {
  const p = req.session && req.session.mfaPending;
  if (!p || Date.now() - p.at > PENDING_TTL_MS) return null;
  return p;
}

exports.getMfa = async (req, res) => {
  const p = pendingOf(req);
  if (!p) return res.redirect('/login');
  const st = await mfa.status(p.user.id);
  res.render('login-mfa', { st, error: null, sent: Boolean(p.tg), name: p.user.fullname });
};

exports.postMfa = async (req, res) => {
  const p = pendingOf(req);
  if (!p) return res.render('login', { error: 'หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่' });
  const code = String((req.body && req.body.code) || '').trim();
  const st = await mfa.status(p.user.id);
  let method = null;
  if (/^\d{6}$/.test(code) && p.tg && Date.now() < p.tg.exp && mfa.hashCode(code) === p.tg.hash) method = 'telegram';
  else if (/^\d{6}$/.test(code) && st.totp && await mfa.verifyTotpFor(p.user.id, code)) method = 'totp';
  else if (/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(code) && await mfa.useRecovery(p.user.id, code)) method = 'recovery';

  if (!method) {
    p.attempts += 1;
    logAudit(req, 'mfa_failed', 'auth', p.user.id, { attempts: p.attempts }, p.user);
    if (p.attempts >= 5) {
      delete req.session.mfaPending;
      return req.session.save(() => res.render('login', { error: 'กรอกรหัสยืนยันผิดหลายครั้ง กรุณาเข้าสู่ระบบใหม่' }));
    }
    return req.session.save(() => res.status(401).render('login-mfa', { st, error: `รหัสไม่ถูกต้อง (เหลือ ${5 - p.attempts} ครั้ง)`, sent: Boolean(p.tg), name: p.user.fullname }));
  }
  const left = method === 'recovery' ? (await mfa.status(p.user.id)).recoveryLeft : undefined;
  finishLogin(req, res, p.user, p.returnTo || '/', { mfa: method, recoveryLeft: left });
};

/** Send (or resend, at most once a minute) the Telegram code. */
exports.sendMfaTelegram = async (req, res) => {
  const p = pendingOf(req);
  if (!p) return res.redirect('/login');
  if (!p.tg || Date.now() - p.tg.sentAt > 60 * 1000) await sendTelegramCode(req, p.user.id).catch(() => false);
  req.session.save(() => res.redirect('/login/mfa'));
};

exports.logout = (req, res) => {
  if (req.session && req.session.user) logAudit(req, 'logout', 'auth', req.session.user.username);
  req.session.destroy();
  res.redirect('/login');
};
