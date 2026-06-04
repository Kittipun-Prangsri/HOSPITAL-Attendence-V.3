const { hosofficePool } = require('../../src/config/db');

async function check() {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    console.log('Inspecting scans of today:', today);

    const [scans] = await hosofficePool.query(`
      SELECT 
        h.EmployeeID, 
        h.AccessDate, 
        h.AccessTime, 
        h.Direction, 
        h.DeviceName,
        h.is_notified,
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as fullname
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ?
        AND (
          (p.LINE_YOUR_USER_ID IS NOT NULL AND p.LINE_YOUR_USER_ID != '')
          OR
          (p.TELEGRAM_CHAT_ID IS NOT NULL AND p.TELEGRAM_CHAT_ID != '')
        )
      ORDER BY h.AccessTime ASC
    `, [today]);

    console.table(scans);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
