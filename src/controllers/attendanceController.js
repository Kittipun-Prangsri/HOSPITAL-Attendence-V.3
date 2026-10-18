const NotificationService = require('../services/notificationService');
const { getLateThreshold } = require('../services/workSettings');
const { pool, hosofficePool, STAFF } = require('../config/db');
const flexBuilder = require('../services/flexBuilder');
const { getTimeInTimezone, isLateCheckIn, toDateKey } = require('../utils/attendanceTime');

function getStatusLabel(attendanceStatus, authResult, direction) {
  if (authResult === 'Failed') {
    return '❌ สแกนไม่ผ่าน';
  }
  
  const status = (attendanceStatus || direction || '').toLowerCase();
  switch (status) {
    case 'i':
    case 'in':
      return '✅ สแกนเข้างาน (Check-in)';
    case 'o':
    case 'out':
      return '📤 สแกนออกงาน (Check-out)';
    default:
      return 'ไม่ระบุสถานะ';
  }
}

/**
 * Controller to handle manual or automated attendance logging
 */
exports.checkIn = async (req, res) => {
  const { userId, userName } = req.body;
  const currentUser = req.session.user;
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');
  if (!userId || !userName || (!isPrivileged && String(userId) !== String(currentUser.id) && String(userId) !== String(currentUser.username))) {
    return res.status(400).json({ success: false, error: 'Invalid attendance request' });
  }
  const now = new Date();
  const currentTime = getTimeInTimezone(now);
  const lateThreshold = await getLateThreshold();
  
  const isLate = isLateCheckIn(currentTime, lateThreshold);
  
  try {
    // 1. Save to local attendance table
    const [result] = await pool.query(
      'INSERT INTO attendance (user_name, status, timestamp, is_late) VALUES (?, ?, ?, ?)',
      [isPrivileged ? userName : currentUser.fullname, 'check-in', now, isLate]
    );

    const statusMsg = isLate ? '⏰ สาย (Late)' : '✅ ปกติ (On-time)';
    const message = `🔔 *แจ้งเตือนการลงเวลา*\n\n` +
                    `👤 ผู้ใช้งาน: ${userName}\n` +
                    `📍 สถานะ: เข้างาน (${statusMsg})\n` +
                    `🕒 เวลา: ${currentTime}\n` +
                    `📅 วันที่: ${now.toLocaleDateString('th-TH')}`;

    // 2. Send private notification to the user
    await NotificationService.sendPrivate(userId, message);

    res.json({
      success: true,
      message: 'Check-in logged successfully',
      isLate,
      time: currentTime
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

exports.checkOut = async (req, res) => {
  const { userId, userName } = req.body;
  const currentUser = req.session.user;
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');
  if (!userId || !userName || (!isPrivileged && String(userId) !== String(currentUser.id) && String(userId) !== String(currentUser.username))) {
    return res.status(400).json({ success: false, error: 'Invalid attendance request' });
  }
  const now = new Date();
  const currentTime = getTimeInTimezone(now);

  try {
    await pool.query(
      'INSERT INTO attendance (user_name, status, timestamp, is_late) VALUES (?, ?, ?, ?)',
      [isPrivileged ? userName : currentUser.fullname, 'check-out', now, false]
    );

    const message = `🔔 *แจ้งเตือนการลงเวลา*\n\n` +
                    `👤 ผู้ใช้งาน: ${userName}\n` +
                    `📍 สถานะ: ออกงาน\n` +
                    `🕒 เวลา: ${currentTime}\n` +
                    `📅 วันที่: ${now.toLocaleDateString('th-TH')}`;

    await NotificationService.sendPrivate(userId, message);

    res.json({ success: true, message: 'Check-out logged successfully' });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * Manage Notification Mappings (Admin only)
 */
const fs = require('fs');
const path = require('path');
const MAPPING_PATH = path.join(__dirname, '../../data/notification_mappings.json');

exports.getMappings = (req, res) => {
  try {
    const data = fs.readFileSync(MAPPING_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: 'Failed to read mappings' });
  }
};

exports.updateMapping = (req, res) => {
  const { userId, telegram_chat_id, line_user_id } = req.body;
  try {
    let mappings = {};
    if (fs.existsSync(MAPPING_PATH)) {
      mappings = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
    }

    mappings[userId] = { telegram_chat_id, line_user_id };
    fs.writeFileSync(MAPPING_PATH, JSON.stringify(mappings, null, 2));

    res.json({ success: true, message: 'Mapping updated' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update mapping' });
  }
};

/** LINE / Telegram channel health, LINE push quota and today's delivery counts (Admin only) */
exports.getNotificationStatus = async (req, res) => {
  try {
    const status = await NotificationService.getStatus();
    const [[today]] = await pool.query(
      `SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped
       FROM notification_deliveries WHERE access_date = CURDATE()`
    );
    status.today = { sent: Number(today.sent) || 0, failed: Number(today.failed) || 0, skipped: Number(today.skipped) || 0 };
    status.linePolicy = NotificationService.linePushPolicy();
    // Scanner feed and last backup (each optional: a failure here must not hide the rest of the panel)
    status.scanner = await require('../services/scannerWatch').status().catch(err => ({ error: err.message }));
    status.backup = await require('../services/dbBackup').latestBackup().catch(() => null);
    status.realtime = { enabled: process.env.ENABLE_REALTIME_NOTIFICATIONS !== 'false', copyAdmin: process.env.REALTIME_COPY_ADMIN !== 'false' };
    res.json({ success: true, status });
  } catch (e) {
    console.error('Error in /api/notifications/status:', e);
    res.status(500).json({ success: false, error: 'ตรวจสอบสถานะการแจ้งเตือนไม่สำเร็จ' });
  }
};

/**
 * List LINE/Telegram delivery attempts that failed (Admin only)
 */
exports.getFailedNotifications = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT employee_id, access_date, access_time, attempts, last_error, updated_at
       FROM notification_deliveries WHERE status = 'failed'
       ORDER BY updated_at DESC LIMIT 200`
    );

    let nameMap = {};
    const employeeIds = [...new Set(rows.map(row => row.employee_id))];
    if (employeeIds.length > 0) {
      const [people] = await hosofficePool.query(
        `SELECT FINGLE_ID, CONCAT(HR_FNAME, ' ', HR_LNAME) AS name FROM ${STAFF} WHERE FINGLE_ID IN (?)`,
        [employeeIds]
      );
      nameMap = Object.fromEntries(people.map(p => [p.FINGLE_ID, p.name]));
    }

    const failures = rows.map(row => ({
      employeeId: row.employee_id,
      employeeName: nameMap[row.employee_id] || row.employee_id,
      accessDate: toDateKey(row.access_date), // DATE → Date at +07:00; JSON would show the previous day in UTC
      accessTime: row.access_time,
      attempts: row.attempts,
      lastError: row.last_error,
      updatedAt: row.updated_at
    }));

    res.json({ success: true, failures });
  } catch (e) {
    console.error('Error in /api/notifications/failed:', e);
    res.status(500).json({ error: 'Failed to load failed notifications', failures: [] });
  }
};

