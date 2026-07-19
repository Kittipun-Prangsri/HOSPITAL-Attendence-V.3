const NotificationService = require('../services/notificationService');
const { pool } = require('../config/db');
const { getTimeInTimezone, isLateCheckIn } = require('../utils/attendanceTime');

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
  const lateThreshold = '08:31:00'; // Define threshold
  
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
