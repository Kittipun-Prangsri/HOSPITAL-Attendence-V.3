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
  },
  {
    id: '004_leave_requests_and_app_settings',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS leave_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          hr_person_id INT NULL,
          fullname VARCHAR(150) NOT NULL,
          dept VARCHAR(150) NULL,
          leave_type ENUM('sick', 'personal', 'vacation', 'maternity', 'ordination', 'other') NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          half_day ENUM('none', 'morning', 'afternoon') NOT NULL DEFAULT 'none',
          days DECIMAL(5,1) NOT NULL,
          reason TEXT NOT NULL,
          contact VARCHAR(255) NULL,
          status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
          reviewer VARCHAR(150) NULL,
          review_comment TEXT NULL,
          submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP NULL,
          KEY idx_leave_employee (employee_id, start_date),
          KEY idx_leave_status (status, start_date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key VARCHAR(100) PRIMARY KEY,
          setting_value JSON NOT NULL,
          updated_by VARCHAR(150) NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    id: '005_holidays_ot_attachments_audit',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS holidays (
          holiday_date DATE PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          created_by VARCHAR(150) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ot_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          hr_person_id INT NULL,
          fullname VARCHAR(150) NOT NULL,
          dept VARCHAR(150) NULL,
          work_date DATE NOT NULL,
          start_time CHAR(5) NOT NULL,
          end_time CHAR(5) NOT NULL,
          hours DECIMAL(4,1) NOT NULL,
          reason TEXT NOT NULL,
          status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
          reviewer VARCHAR(150) NULL,
          review_comment TEXT NULL,
          submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP NULL,
          KEY idx_ot_employee (employee_id, work_date),
          KEY idx_ot_status (status, work_date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          actor_id VARCHAR(50) NULL,
          actor_name VARCHAR(150) NULL,
          actor_role VARCHAR(20) NULL,
          action VARCHAR(50) NOT NULL,
          entity VARCHAR(50) NOT NULL,
          entity_id VARCHAR(100) NULL,
          detail TEXT NULL,
          ip VARCHAR(64) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_audit_created (created_at),
          KEY idx_audit_entity (entity, created_at)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      const [cols] = await pool.query("SHOW COLUMNS FROM leave_requests LIKE 'attachment_path'");
      if (cols.length === 0) {
        await pool.query(`ALTER TABLE leave_requests
          ADD COLUMN attachment_path VARCHAR(255) NULL AFTER contact,
          ADD COLUMN attachment_name VARCHAR(255) NULL AFTER attachment_path,
          ADD COLUMN attachment_type VARCHAR(50) NULL AFTER attachment_name`);
      }
    }
  },
  {
    // The weekly page stored MORNING/AFTERNOON/NIGHT while the monthly planner stored เช้า/บ่าย/ดึก.
    // Convert everything to the canonical codes (src/utils/shifts.js); custom names stay as typed.
    id: '006_canonical_shift_codes',
    up: async () => {
      await pool.query(`
        UPDATE schedule_entries SET shift = CASE
          WHEN LOWER(TRIM(shift)) IN ('morning', 'เช้า', 'เวรเช้า', 'กะเช้า') THEN 'MORNING'
          WHEN LOWER(TRIM(shift)) IN ('afternoon', 'บ่าย', 'เวรบ่าย', 'กะบ่าย') THEN 'AFTERNOON'
          WHEN LOWER(TRIM(shift)) IN ('night', 'ดึก', 'เวรดึก', 'กะดึก') THEN 'NIGHT'
          ELSE shift END
        WHERE LOWER(TRIM(shift)) IN ('morning', 'เช้า', 'เวรเช้า', 'กะเช้า', 'afternoon', 'บ่าย', 'เวรบ่าย', 'กะบ่าย', 'night', 'ดึก', 'เวรดึก', 'กะดึก')
      `);
    }
  },
  {
    // Date ranges when the Hikvision feed was down: no ABSENT incidents are generated inside them
    id: '007_scan_outages',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scan_outages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          reason VARCHAR(255) NOT NULL,
          created_by VARCHAR(150) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_scan_outages_range (start_date, end_date)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    // Scan cards that were deliberately not pushed (LINE kept for important messages, no Telegram)
    id: '008_delivery_skipped_status',
    up: async () => {
      await pool.query("ALTER TABLE notification_deliveries MODIFY status ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending'");
    }
  },
  {
    // Mobile face scan: enrolled face templates (encrypted) and the evidence for every mobile scan
    id: '009_mobile_face_scan',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS face_enrollments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          hr_person_id INT NULL,
          fullname VARCHAR(150) NULL,
          status ENUM('pending', 'approved', 'rejected', 'revoked') NOT NULL DEFAULT 'pending',
          template TEXT NULL,
          model_version VARCHAR(50) NOT NULL,
          photo_file VARCHAR(100) NULL,
          quality JSON NULL,
          consent_version VARCHAR(20) NOT NULL,
          consent_at DATETIME NOT NULL,
          line_user_id VARCHAR(64) NULL,
          reviewed_by VARCHAR(150) NULL,
          reviewed_at DATETIME NULL,
          review_note VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_face_emp_status (employee_id, status),
          KEY idx_face_status (status)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mobile_scans (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          enrollment_id INT NULL,
          scanned_at DATETIME NOT NULL,
          direction ENUM('in', 'out') NOT NULL,
          latitude DECIMAL(10, 7) NULL,
          longitude DECIMAL(10, 7) NULL,
          accuracy_m DECIMAL(8, 1) NULL,
          site_name VARCHAR(100) NULL,
          distance_m DECIMAL(10, 1) NULL,
          inside_area TINYINT(1) NOT NULL DEFAULT 0,
          match_score DECIMAL(5, 3) NULL,
          real_score DECIMAL(5, 3) NULL,
          live_score DECIMAL(5, 3) NULL,
          challenge VARCHAR(30) NULL,
          photo_file VARCHAR(100) NULL,
          status ENUM('accepted', 'pending', 'rejected') NOT NULL,
          reject_reason VARCHAR(255) NULL,
          reviewed_by VARCHAR(150) NULL,
          reviewed_at DATETIME NULL,
          line_user_id VARCHAR(64) NULL,
          user_agent VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_mscan_emp_time (employee_id, scanned_at),
          KEY idx_mscan_status (status)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    // Department heads: may review leave / OT / excuses / mobile scans of staff in these departments only
    id: '010_department_heads',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS department_heads (
          hr_person_id INT NOT NULL,
          department_id INT NOT NULL,
          created_by VARCHAR(150) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (hr_person_id, department_id),
          KEY idx_dept_heads_dept (department_id)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    }
  },
  {
    // LINE / Telegram links live in the app DB from now on (HOSoffice hr_person is no longer written).
    // One active account per person per channel, one person per account. History goes to audit_log.
    id: '011_messaging_links',
    up: async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messaging_links (
          hr_person_id INT NOT NULL,
          channel VARCHAR(10) NOT NULL,
          external_id VARCHAR(64) NOT NULL,
          linked_via VARCHAR(20) NOT NULL,
          linked_by VARCHAR(150) NULL,
          linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (hr_person_id, channel),
          UNIQUE KEY uniq_channel_external (channel, external_id)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      // One-time import of the links HR typed into HOSoffice (valid formats only; first owner wins on duplicates)
      let rows = [];
      try {
        [rows] = await hosofficePool.query(
          "SELECT ID, LINE_YOUR_USER_ID AS line, TELEGRAM_CHAT_ID AS tg FROM hr_person WHERE COALESCE(LINE_YOUR_USER_ID, '') <> '' OR COALESCE(TELEGRAM_CHAT_ID, '') <> '' ORDER BY ID");
      } catch (err) {
        console.warn('[migrate] 011: HOSoffice link columns not readable, nothing imported:', err.message);
      }
      const values = [];
      for (const r of rows) {
        const line = String(r.line || '').trim();
        const tg = String(r.tg || '').trim();
        if (/^U[0-9a-f]{32}$/.test(line)) values.push([r.ID, 'line', line, 'import', 'migration 011']);
        if (/^-?\d{4,20}$/.test(tg)) values.push([r.ID, 'telegram', tg, 'import', 'migration 011']);
      }
      if (values.length) {
        await pool.query('INSERT IGNORE INTO messaging_links (hr_person_id, channel, external_id, linked_via, linked_by) VALUES ?', [values]);
      }
      console.log(`[migrate] 011: imported ${values.length} LINE/Telegram link(s) from HOSoffice`);
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

module.exports = { runMigrations, migrations };
