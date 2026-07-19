const { pool, hosofficePool } = require('../src/config/db');

const migrations = [
  {
    id: '001_core_attendance_tables',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          fullname VARCHAR(100),
          role ENUM('super', 'manager', 'staff', 'user', 'admin') DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_name VARCHAR(255),
          status ENUM('check-in', 'check-out'),
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_late BOOLEAN
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance_excuses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) NOT NULL,
          fullname VARCHAR(100) NOT NULL,
          date DATE NOT NULL,
          issue_type ENUM('scan-failed', 'absent', 'leave', 'late') NOT NULL,
          reason TEXT NOT NULL,
          submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
          admin_comment TEXT,
          reviewed_at TIMESTAMP NULL,
          UNIQUE KEY unique_user_date (username, date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incident_logs (
          incident_id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          incident_date DATE NOT NULL,
          incident_type ENUM('LATE', 'ABSENT') NOT NULL,
          status ENUM('PENDING', 'OVERDUE', 'SUBMITTED') DEFAULT 'PENDING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_emp_date_type (employee_id, incident_date, incident_type)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    id: '002_schedule_and_notification_delivery',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_entries (
          employee_id VARCHAR(50) NOT NULL,
          schedule_date DATE NOT NULL,
          shift VARCHAR(50) NOT NULL,
          created_by VARCHAR(50) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (employee_id, schedule_date),
          KEY idx_schedule_date (schedule_date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_audit_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          schedule_date DATE NOT NULL,
          previous_shift VARCHAR(50) NULL,
          new_shift VARCHAR(50) NULL,
          changed_by VARCHAR(50) NULL,
          changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_schedule_audit_date (schedule_date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_deliveries (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          access_date DATE NOT NULL,
          access_time VARCHAR(20) NOT NULL,
          status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
          attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
          last_error TEXT NULL,
          next_attempt_at DATETIME NULL,
          sent_at DATETIME NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_scan_delivery (employee_id, access_date, access_time),
          KEY idx_delivery_retry (status, next_attempt_at)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    id: '003_hosoffice_compatibility',
    up: async () => {
      const [columns] = await hosofficePool.query("SHOW COLUMNS FROM hr_person LIKE 'TELEGRAM_CHAT_ID'");
      if (columns.length === 0) {
        await hosofficePool.query('ALTER TABLE hr_person ADD COLUMN TELEGRAM_CHAT_ID VARCHAR(100) NULL AFTER LINE_YOUR_USER_ID');
      }
      const [indexes] = await hosofficePool.query("SHOW INDEX FROM hikvision WHERE Key_name = 'idx_hikvision_emp_date'");
      if (indexes.length === 0) {
        await hosofficePool.query('ALTER TABLE hikvision ADD INDEX idx_hikvision_emp_date (EmployeeID, AccessDate)');
      }
    }
  }
];

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  const [appliedRows] = await pool.query('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map(row => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await migration.up();
    await pool.query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    console.log(`[migrate] Applied ${migration.id}`);
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => { console.log('[migrate] Complete.'); process.exit(0); })
    .catch(error => { console.error('[migrate] Failed:', error.message); process.exit(1); });
}

module.exports = { runMigrations };
