const { hosofficePool } = require('../config/db');
const NotificationService = require('./notificationService');

let intervalId = null;
const processedScans = new Set();
let currentTodayStr = null;

async function checkNewScans() {
  try {
    // Sv-SE locale returns YYYY-MM-DD format, which matches the varchar date in HOSoffice
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    
    // Reset cache daily to prevent memory growth
    if (today !== currentTodayStr) {
      currentTodayStr = today;
      processedScans.clear();
    }
    
    // 1. Fetch unprocessed scans for today (is_notified = 1 or 2) that have a registered LINE ID or Telegram Chat ID in hr_person
    const [scans] = await hosofficePool.query(`
      SELECT 
        h.EmployeeID, 
        h.AccessDate, 
        h.AccessTime, 
        h.Direction, 
        h.DeviceName,
        h.ReaderName,
        h.SkinSurfaceTemperature,
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as fullname
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
        AND (
          (p.LINE_YOUR_USER_ID IS NOT NULL AND p.LINE_YOUR_USER_ID != '')
          OR
          (p.TELEGRAM_CHAT_ID IS NOT NULL AND p.TELEGRAM_CHAT_ID != '')
        )
      ORDER BY h.AccessTime ASC
      LIMIT 10
    `, [today]);

    // 2. Automatically mark other scans for employees without notification IDs as notified (value 3) to keep database clean
    await hosofficePool.query(`
      UPDATE hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      SET h.is_notified = 3
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
        AND (
          p.FINGLE_ID IS NULL
          OR (
            (p.LINE_YOUR_USER_ID IS NULL OR p.LINE_YOUR_USER_ID = '')
            AND
            (p.TELEGRAM_CHAT_ID IS NULL OR p.TELEGRAM_CHAT_ID = '')
          )
        )
    `, [today]);

    if (scans.length === 0) return;

    console.log(`[RealtimeNotifier] Found ${scans.length} unprocessed scans to notify.`);

    for (const scan of scans) {
      const { EmployeeID, AccessDate, AccessTime, Direction, DeviceName, ReaderName, SkinSurfaceTemperature, line_user_id, telegram_chat_id, fullname } = scan;

      // Prevent duplicate notifications in the same run/session using in-memory cache
      const scanKey = `${EmployeeID}_${AccessDate}_${AccessTime}`;
      if (processedScans.has(scanKey)) {
        continue;
      }
      processedScans.add(scanKey);

      // Update to processed immediately to prevent duplicate runs
      await hosofficePool.query(`
        UPDATE hikvision 
        SET is_notified = 3 
        WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?
      `, [EmployeeID, AccessDate, AccessTime]);

      if (line_user_id || telegram_chat_id) {
        // Bypass actual sending if disabled in configuration
        if (process.env.ENABLE_REALTIME_NOTIFICATIONS === 'false') {
          console.log(`[RealtimeNotifier] Real-time notifications are disabled in .env. Skipping push to ${fullname} (${EmployeeID}).`);
          continue;
        }

        let directionThai = 'สแกนผ่านเครื่อง';
        if (Direction === 'in') directionThai = 'เข้างาน (Check-in)';
        if (Direction === 'out') directionThai = 'ออกงาน (Check-out)';

        const location = DeviceName || 'ไม่ระบุจุดสแกน';
        const dateThai = new Date(AccessDate).toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        let message = `🔔 *บันทึกเวลาทำงานสำเร็จ*\n\n` +
                      `👤 คุณ: ${fullname}\n` +
                      `📅 วันที่: ${dateThai}\n` +
                      `⏰ เวลา: ${AccessTime} น.\n` +
                      `📍 สถานะ: ${directionThai}\n` +
                      `🚪 จุดบันทึก: ${location}`;

        if (SkinSurfaceTemperature && SkinSurfaceTemperature.trim() !== '') {
          message += `\n🌡️ อุณหภูมิ: ${SkinSurfaceTemperature} °C`;
        }

        // Send parallel / fallback notifications
        const result = await NotificationService.sendDirectNotification(line_user_id, telegram_chat_id, message);
        if (result.success) {
          console.log(`[RealtimeNotifier] Successfully sent notification to ${fullname} (${EmployeeID}). LINE: ${result.line}, Telegram: ${result.telegram}`);
        } else {
          console.error(`[RealtimeNotifier] Failed to send notification to ${fullname} (${EmployeeID}). Both services failed.`);
        }
      } else {
        console.log(`[RealtimeNotifier] No notification ID mapped for user ${fullname || EmployeeID}`);
      }
    }
  } catch (error) {
    console.error('[RealtimeNotifier] Error in checkNewScans:', error);
  }
}

function start(intervalMs = 5000) { // Polling every 5 seconds for a near real-time feel
  if (intervalId) return;
  console.log(`[RealtimeNotifier] Starting real-time Hikvision scanner (interval: ${intervalMs}ms)...`);
  intervalId = setInterval(checkNewScans, intervalMs);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[RealtimeNotifier] Stopped real-time Hikvision scanner.');
  }
}

module.exports = {
  start,
  stop
};
