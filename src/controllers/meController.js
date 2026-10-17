const { hosofficePool } = require('../config/db');
const { myMonth } = require('../services/myMonth');

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
