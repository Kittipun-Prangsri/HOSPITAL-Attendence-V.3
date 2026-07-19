const { hosofficePool } = require('../../src/config/db');

async function listUsers() {
  try {
    const [rows] = await hosofficePool.query(`
      SELECT FINGLE_ID, HR_CID, CONCAT(HR_FNAME, ' ', HR_LNAME) as name, LINE_YOUR_USER_ID
      FROM hr_person
      WHERE LINE_YOUR_USER_ID IS NOT NULL AND LINE_YOUR_USER_ID != ''
    `);
    console.log('Users with registered LINE IDs:');
    console.table(rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
listUsers();
