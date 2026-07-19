const { hosofficePool } = require('../../src/config/db');

async function inspect() {
  try {
    console.log('--- Sample hikvision rows ---');
    const [scans] = await hosofficePool.query('SELECT EmployeeID, PersonName, AccessDate, AccessTime FROM hikvision LIMIT 5');
    console.table(scans);

    console.log('--- Sample hr_person rows ---');
    const [person] = await hosofficePool.query('SELECT ID, FINGLE_ID, HR_CID, HR_FNAME, HR_LNAME, LINE_YOUR_USER_ID FROM hr_person WHERE FINGLE_ID IS NOT NULL OR LINE_YOUR_USER_ID IS NOT NULL LIMIT 5');
    console.table(person);

    console.log('--- Check Join matching ---');
    const [joined] = await hosofficePool.query(`
      SELECT h.EmployeeID, h.PersonName, p.ID as person_id, p.FINGLE_ID, p.HR_CID, p.LINE_YOUR_USER_ID
      FROM hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      LIMIT 5
    `);
    console.table(joined);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

inspect();
