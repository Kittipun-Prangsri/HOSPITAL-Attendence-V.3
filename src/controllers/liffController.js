const { hosofficePool } = require('../config/db');
const { logAudit } = require('../utils/audit');
const bcrypt = require('bcryptjs');
const { personByExternal, setLink, linkOf } = require('../services/messagingLinks');

/**
 * Ask LINE to verify a LIFF ID token. Never trust a userId sent by the page itself.
 * Resolves to the LINE user id (sub) or null.
 */
async function verifyIdToken(idToken) {
  const channelId = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  if (!channelId || typeof idToken !== 'string' || idToken.length > 4096) return null;
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && typeof data.sub === 'string' && /^U[0-9a-f]{32}$/.test(data.sub) ? data.sub : null;
}

/** POST /api/liff/login { idToken } → signs in the staff member whose LINE account is linked. */
exports.login = async (req, res) => {
  if (!process.env.LINE_LOGIN_CHANNEL_ID) {
    return res.status(503).json({ success: false, error: 'ยังไม่ได้ตั้งค่า LINE Login (LINE_LOGIN_CHANNEL_ID)' });
  }
  let lineUserId;
  try {
    lineUserId = await verifyIdToken(req.body && req.body.idToken);
  } catch (err) {
    console.error('[LIFF] verify failed:', err.message);
    return res.status(502).json({ success: false, error: 'ตรวจสอบบัญชี LINE ไม่สำเร็จ ลองใหม่อีกครั้ง' });
  }
  if (!lineUserId) return res.status(401).json({ success: false, error: 'บัญชี LINE ไม่ถูกต้องหรือหมดอายุ กรุณาเปิดจาก LINE อีกครั้ง' });

  try {
    const personId = await personByExternal('line', lineUserId);
    const [rows] = personId ? await hosofficePool.query(
      `SELECT ID AS id, HR_CID AS cid, FINGLE_ID AS fingle_id, CONCAT(HR_FNAME, ' ', HR_LNAME) AS fullname, USER_TYPE AS role
       FROM hr_person WHERE ID = ? AND HR_STATUS_ID IN ('01', '02', '03', '04', '09') LIMIT 1`,
      [personId]
    ) : [[]];
    if (rows.length !== 1) {
      // Not linked (or linked to two people): show the id so HR can link it
      return res.status(404).json({ success: false, notLinked: true, lineUserId, error: 'บัญชี LINE นี้ยังไม่ได้ผูกกับข้อมูลบุคลากร กรุณาแจ้ง HR / IT พร้อมไอดีด้านล่าง' });
    }
    const user = rows[0];
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ success: false, error: 'สร้างเซสชันไม่สำเร็จ' });
      // LINE sign-in skips the two-step check, so it never carries admin rights (staff + head features only)
      req.session.user = {
        id: user.id,
        username: user.fingle_id || user.cid,
        fullname: user.fullname,
        role: 'user',
        via: 'liff'
      };
      logAudit(req, 'login', 'auth', user.id, { via: 'liff' }, req.session.user);
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ success: false, error: 'บันทึกเซสชันไม่สำเร็จ' });
        res.json({ success: true });
      });
    });
  } catch (err) {
    console.error('[LIFF] login error:', err);
    res.status(500).json({ success: false, error: 'เข้าสู่ระบบไม่สำเร็จ' });
  }
};

/** Start a normal web session for this hr_person row (same shape as the password login). */
function startSession(req, res, user, via, done) {
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ success: false, error: 'สร้างเซสชันไม่สำเร็จ' });
    req.session.user = {
      id: user.id,
      username: user.fingle_id || user.cid,
      fullname: user.fullname,
      role: 'user', // see login(): no admin rights through LINE
      via
    };
    done();
  });
}

/**
 * POST /api/liff/link { idToken, username, password }
 * Links the LINE account to the staff member only when BOTH check out: LINE vouches for the account
 * (ID token verified with LINE) and the HOSoffice password proves who the person is.
 */
exports.link = async (req, res) => {
  if (!process.env.LINE_LOGIN_CHANNEL_ID) return res.status(503).json({ success: false, error: 'ยังไม่ได้ตั้งค่า LINE Login' });
  const { idToken, username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || username.length > 50 || password.length > 200) {
    return res.status(400).json({ success: false, error: 'กรอกรหัสผู้ใช้และรหัสผ่าน' });
  }
  let lineUserId;
  try { lineUserId = await verifyIdToken(idToken); } catch (err) { lineUserId = null; }
  if (!lineUserId) return res.status(401).json({ success: false, error: 'บัญชี LINE ไม่ถูกต้องหรือหมดอายุ กรุณาเปิดจาก LINE อีกครั้ง' });

  try {
    const [rows] = await hosofficePool.query(
      `SELECT ID AS id, HR_CID AS cid, FINGLE_ID AS fingle_id, CONCAT(HR_FNAME, ' ', HR_LNAME) AS fullname, USER_TYPE AS role, HR_PASSWORD_HASH AS hash
       FROM hr_person WHERE (HR_CID = ? OR FINGLE_ID = ?) AND HR_STATUS_ID IN ('01', '02', '03', '04', '09') LIMIT 1`,
      [username.trim(), username.trim()]);
    const user = rows[0];
    const ok = user && user.hash && await bcrypt.compare(password, user.hash);
    if (!ok) {
      logAudit(req, 'link_failed', 'line', null, { username: username.trim().slice(0, 50) }, { username: null, fullname: null, role: null });
      return res.status(401).json({ success: false, error: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const before = await linkOf(user.id);
    let previous;
    try {
      ({ previous } = await setLink({ personId: user.id, channel: 'line', externalId: lineUserId, via: 'liff', by: user.fullname }));
    } catch (err) {
      if (err.code === 'TAKEN') return res.status(409).json({ success: false, error: 'บัญชี LINE นี้ผูกกับบุคลากรคนอื่นอยู่แล้ว กรุณาติดต่อ HR' });
      throw err;
    }
    res.locals.loginOk = true; // clears the failed-attempt counter
    logAudit(req, previous ? 'relink' : 'link', 'line', user.id, { via: 'liff', replaced: Boolean(previous) },
      { username: user.fingle_id || user.cid, fullname: user.fullname, role: user.role });
    if (previous || before.telegram) {
      // Tell the old account(s) so a takeover does not go unnoticed
      const NotificationService = require('../services/notificationService');
      const msg = `🔐 บัญชี KHH HRM ของคุณ${user.fullname} ถูกผูกกับ LINE ${previous ? 'บัญชีใหม่' : ''}แล้ว\nถ้าไม่ได้ทำเอง กรุณาเปลี่ยนรหัสผ่านและแจ้ง HR ทันที`;
      NotificationService.sendDirectNotification(previous, before.telegram, msg).catch(() => {});
    }
    startSession(req, res, user, 'liff', () => {
      req.session.save(() => res.json({ success: true, message: 'ผูกบัญชี LINE เรียบร้อยแล้ว', relinked: Boolean(previous) }));
    });
  } catch (err) {
    console.error('[LIFF] link failed:', err);
    res.status(500).json({ success: false, error: 'ผูกบัญชีไม่สำเร็จ' });
  }
};

exports.verifyIdToken = verifyIdToken;
