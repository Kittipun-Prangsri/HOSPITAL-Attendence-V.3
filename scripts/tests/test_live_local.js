const mysql = require('mysql2/promise');

async function testLiveScans() {
  const pool = mysql.createPool({ 
    host: '192.168.80.7', 
    user: 'Khos', 
    password: 'KH10866@zjkowfh', 
    database: 'hosoffice' 
  });

  const targetDateStr = '2026-03-24';

  try {
    const [rows] = await pool.query(`
      SELECT 
        h.Direction as type,
        COALESCE(h.PersonName, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME)) as name,
        COALESCE(h.PersonGroup, d.HR_DEPARTMENT_NAME) as dept,
        h.AccessTime as time,
        h.AccessDate as date,
        p.FINGLE_ID
      FROM hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE h.AccessDate = ?
      LIMIT 10
    `, [targetDateStr]);
    console.log(`Live Scans for ${targetDateStr}:`, rows.length);
    console.table(rows);
    
    // Check if the query without p.ID filter works
    const [allRows] = await pool.query('SELECT EmployeeID, AccessDate, PersonName FROM hikvision WHERE AccessDate = ?', [targetDateStr]);
    console.log(`Total Scans for ${targetDateStr} in hikvision:`, allRows.length);
    console.table(allRows);

    process.exit(0);
  } catch (err) {
    console.error('Test query error:', err);
    process.exit(1);
  }
}

testLiveScans();
