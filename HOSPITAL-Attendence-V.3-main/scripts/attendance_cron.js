const cron = require('node-cron');
const { pool } = require('../src/config/db');
const NotificationService = require('../src/services/notificationService');

/**
 * SQL to create the attendance table if not exists:
 * 
 * CREATE TABLE IF NOT EXISTS attendance (
 *   id INT AUTO_INCREMENT PRIMARY KEY,
 *   user_name VARCHAR(255),
 *   status ENUM('check-in', 'check-out'),
 *   timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   is_late BOOLEAN
 * );
 */

async function runWeeklySummary() {
  console.log('--- Executing Weekly Attendance Summary ---');
  try {
    // SQL Query to count total late and on-time check-ins for the current week
    // YEARWEEK(timestamp, 1) ensures week starts on Monday
    const query = `
      SELECT 
        COUNT(CASE WHEN is_late = 1 THEN 1 END) as total_late,
        COUNT(CASE WHEN is_late = 0 THEN 1 END) as total_on_time
      FROM attendance
      WHERE YEARWEEK(timestamp, 1) = YEARWEEK(CURDATE(), 1)
      AND status = 'check-in'
    `;

    const [rows] = await pool.query(query);
    const summary = rows[0] || { total_late: 0, total_on_time: 0 };

    const message = `📊 *Weekly Attendance Summary*\n\n` +
                    `✅ On-time: ${summary.total_on_time || 0}\n` +
                    `⏰ Late Arrivals: ${summary.total_late || 0}\n` +
                    `📅 Date: ${new Date().toLocaleDateString('th-TH')}`;

    console.log('Generated Message:', message);
    
    await NotificationService.sendToAdmin(message);
    console.log('Summary sent to admin.');
  } catch (error) {
    console.error('Error in Weekly Attendance Summary:', error);
  }
}

// Schedule: Every Friday at 17:00
// Seconds Minutes Hours DayOfMonth Month DayOfWeek
cron.schedule('0 17 * * 5', () => {
  runWeeklySummary();
}, {
  scheduled: true,
  timezone: "Asia/Bangkok"
});

console.log('Attendance Cron Job Initialized (Every Friday at 17:00)');

// Export for manual testing or integration
module.exports = { runWeeklySummary };

// If run directly, start the cron or run once if --test flag is present
if (require.main === module) {
  if (process.argv.includes('--test')) {
    runWeeklySummary().then(() => process.exit(0));
  }
}
