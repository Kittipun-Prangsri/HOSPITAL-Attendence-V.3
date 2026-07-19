require('dotenv').config();
const mysql = require('mysql2/promise');
const { pool, hosofficePool } = require('../src/config/db');

async function syncHikvisionData() {
  try {
    console.log('🔗 Databases are ready (using pools from src/config/db)...');

    // 1. นำเข้าและอัปเดตข้อมูลพนักงานทั้งหมด (Employees Master)
    // ดึง EmployeeID และชื่อ, แผนก ล่าสุดจากตาราง hikvision
    console.log('🔄 Fetching unique employees from Hikvision logs...');
    const [employees] = await hosofficePool.query(`
      SELECT 
        EmployeeID as id, 
        MAX(PersonName) as name, 
        MAX(PersonGroup) as dept
      FROM hikvision 
      WHERE EmployeeID IS NOT NULL AND EmployeeID != ''
      GROUP BY EmployeeID
    `);

    console.log(`Found ${employees.length} unique employees. Updating hospital_db.employees...`);

    for (const emp of employees) {
      await pool.query(`
        INSERT INTO employees (id, name, dept) 
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name), 
          dept = VALUES(dept)
      `, [emp.id, emp.name, emp.dept]);
    }

    // 2. ดึงข้อมูลเวลาเข้า-ออกงานของ "วันนี้" เพื่อมาอัปเดต Status, time_in, time_out
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`⏱️ Fetching today's (${today}) access logs...`);

    const [todayLogs] = await hosofficePool.query(`
      SELECT 
        EmployeeID as id,
        MIN(CASE WHEN Direction = 'in' OR Direction = 'i' THEN AccessTime END) as time_in,
        MAX(CASE WHEN Direction = 'out' OR Direction = 'o' THEN AccessTime END) as time_out
      FROM hikvision
      WHERE AccessDate = ?
      GROUP BY EmployeeID
    `, [today]);

    for (const log of todayLogs) {
      let status = '—';
      if (log.time_in && !log.time_out) status = 'เข้างาน';
      if (log.time_in && log.time_out) status = 'ออกงาน';

      await pool.query(`
        UPDATE employees 
        SET 
          time_in = ?, 
          time_out = ?, 
          status = ?
        WHERE id = ?
      `, [log.time_in, log.time_out, status, log.id]);
    }

    console.log(`✅ Sync completed successfully! Updated attendance for ${todayLogs.length} staffs today.`);

  } catch (error) {
    console.error('❌ Error syncing data:', error);
  } finally {
    // Pools don't need to be explicitly ended here if the script is intended to run once and exit, 
    // but we should exit the process to close the pool connections.
    process.exit();
  }
}

syncHikvisionData();
