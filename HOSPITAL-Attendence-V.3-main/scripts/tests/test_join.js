const mysql = require('mysql2/promise');
const pool = mysql.createPool({ host: '192.168.80.7', user: 'Khos', password: 'KH10866@zjkowfh', database: 'hosoffice' });
async function test() {
  try {
    const targetDateStr = '2026-03-24';
    const targetMonth = '2026-03';
    let day = '24';
    const dayColumn = `di${day}`;
    console.log("Running Query...")
    const [employees] = await pool.query(`
      SELECT p.FINGLE_ID AS id, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name, d.HR_DEPARTMENT_NAME AS dept,
             s.HR_STATUS_NAME AS role, COALESCE(h.time_in, '') AS \`in\`, COALESCE(h.time_out, '') AS \`out\`,
             m.${dayColumn} AS leave_status
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON p.HR_STATUS_ID = s.HR_STATUS_ID
      LEFT JOIN (SELECT EmployeeID, MIN(AccessTime) as time_in, MAX(AccessTime) as time_out FROM hikvision WHERE AccessDate = ? GROUP BY EmployeeID) h ON p.FINGLE_ID = h.EmployeeID
      LEFT JOIN service_work_scans_morning m ON p.ID = m.hr_person_id AND m.year_and_month = ?
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
      LIMIT 1
    `, [targetDateStr, targetMonth]);
    console.log("Success! Employees:", employees);
    process.exit(0);
  } catch(e) { console.error('Error:', e); process.exit(1); }
}
test();
