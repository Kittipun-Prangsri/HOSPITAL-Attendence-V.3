const { pool, hosofficePool } = require('../src/config/db');

async function inspect() {
  try {
    console.log('--- Inspecting employee KHH00108 in hr_person ---');
    const [rows] = await hosofficePool.query(`
      SELECT ID, FINGLE_ID, HR_CID, HR_FNAME, HR_LNAME, LINE_YOUR_USER_ID, USER_TYPE
      FROM hr_person 
      WHERE FINGLE_ID = 'KHH00108' OR HR_FNAME LIKE '%กิตติพันธ์%'
    `);
    console.table(rows);

    console.log('--- Inspecting today\'s scans in hikvision for KHH00108 ---');
    const [scans] = await hosofficePool.query(`
      SELECT EmployeeID, AccessDate, AccessTime, Direction, DeviceName, is_notified
      FROM hikvision
      WHERE AccessDate = '2026-06-03' AND EmployeeID = 'KHH00108'
      ORDER BY AccessTime DESC
      LIMIT 10
    `);
    console.table(scans);

    console.log('--- Checking if any unprocessed scans exist today ---');
    const [unprocessed] = await hosofficePool.query(`
      SELECT EmployeeID, AccessDate, AccessTime, is_notified
      FROM hikvision
      WHERE AccessDate = '2026-06-03' AND (is_notified = 0 OR is_notified IS NULL)
      LIMIT 5
    `);
    console.table(unprocessed);
  } catch (err) {
    console.error('Inspection error:', err);
  } finally {
    process.exit(0);
  }
}

inspect();
