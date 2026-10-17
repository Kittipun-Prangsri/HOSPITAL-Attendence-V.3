const { hosofficePool } = require('../config/db');
const { logAudit } = require('../utils/audit');

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
    const [rows] = await hosofficePool.query(
      `SELECT ID AS id, HR_CID AS cid, FINGLE_ID AS fingle_id, CONCAT(HR_FNAME, ' ', HR_LNAME) AS fullname, USER_TYPE AS role
       FROM hr_person WHERE LINE_YOUR_USER_ID = ? AND HR_STATUS_ID IN ('01', '02', '03', '04', '09') LIMIT 2`,
      [lineUserId]
    );
    if (rows.length !== 1) {
      // Not linked (or linked to two people): show the id so HR can link it
      return res.status(404).json({ success: false, notLinked: true, lineUserId, error: 'บัญชี LINE นี้ยังไม่ได้ผูกกับข้อมูลบุคลากร กรุณาแจ้ง HR / IT พร้อมไอดีด้านล่าง' });
    }
    const user = rows[0];
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ success: false, error: 'สร้างเซสชันไม่สำเร็จ' });
      req.session.user = {
        id: user.id,
        username: user.fingle_id || user.cid,
        fullname: user.fullname,
        role: user.role ? String(user.role).toLowerCase() : 'user',
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

exports.verifyIdToken = verifyIdToken;
