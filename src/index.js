require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./config/db');
const app = require('./app');
require('../scripts/attendance_cron'); // Initialize attendance cron job
const realtimeNotifier = require('./services/realtimeNotifier');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // 1. Initialize DB Table
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

    // Create attendance table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(255),
        status ENUM('check-in', 'check-out'),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_late BOOLEAN
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Create attendance_excuses table if not exists
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

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running at http://localhost:${PORT}`);
      console.log('Login is integrated with HOSoffice hr_person (using HR_CID as username).');
      realtimeNotifier.start(5000); // Start real-time notifications (5s interval)
    });
  } catch (err) {
    console.error('Initialization error:', err);
    process.exit(1);
  }
}

startServer();
