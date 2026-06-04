const { hosofficePool } = require('../../src/config/db');

async function testQuery() {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    console.log('Today:', today);

    // Run the exact SELECT query
    const [scans] = await hosofficePool.query(`
      SELECT 
        h.EmployeeID, 
        h.AccessDate, 
        h.AccessTime, 
        h.Direction, 
        h.DeviceName,
        h.ReaderName,
        h.SkinSurfaceTemperature,
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        CONCAT(p.HR_FNAME, '   ', p.HR_LNAME) as fullname,
        h.is_notified
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ?
      ORDER BY h.AccessTime DESC
      LIMIT 20
    `, [today]);

    console.log(`Found ${scans.length} scans with mapped users:`);
    console.table(scans);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testQuery();
