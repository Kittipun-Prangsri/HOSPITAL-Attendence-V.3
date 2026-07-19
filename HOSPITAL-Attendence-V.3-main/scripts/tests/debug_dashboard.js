const mysql = require('mysql2/promise');
const pool = mysql.createPool({ host: '192.168.80.7', user: 'Khos', password: 'KH10866@zjkowfh', database: 'hosoffice' });

async function debugDashboard() {
  const targetDateStr = '2026-03-24';
  const targetMonth = '2026-03';
  const lateThresholdTime = '08:31:00';
  const dayColumn = 'di24';

  try {
    // Check total hr_person count
    const [total] = await pool.query('SELECT COUNT(*) as count FROM hr_person');
    console.log('Total hr_person:', total[0].count);

    // Check status counts
    const [statuses] = await pool.query('SELECT HR_STATUS_ID, COUNT(*) as count FROM hr_person GROUP BY HR_STATUS_ID');
    console.log('Status ID counts:');
    console.table(statuses);

    // Check if any personnel match the filter
    const [filtered] = await pool.query("SELECT COUNT(*) as count FROM hr_person WHERE HR_STATUS_ID IN ('01', '02', '03', '04', '09')");
    console.log('Filtered personnel (01-04, 09):', filtered[0].count);

    // Check Hikvision data for today
    const [hikLogs] = await pool.query('SELECT COUNT(*) as count FROM hikvision WHERE AccessDate = ?', [targetDateStr]);
    console.log(`Hikvision logs for ${targetDateStr}:`, hikLogs[0].count);

    // Run the actual dashboard query and see what happens
    const [employees] = await pool.query(`
      SELECT 
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        p.HR_STATUS_ID
      FROM hr_person p
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
      LIMIT 5
    `);
    console.log('Sample filtered employees:', employees);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
debugDashboard();
