const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('./notificationService');
const flexBuilder = require('./flexBuilder');
const { createAttendanceFlex } = require('../utils/flexMessageBuilder');

let intervalId = null;
const processingScans = new Set();
let currentTodayStr = null;

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

async function checkNewScans() {
  try {
    // Sv-SE locale returns YYYY-MM-DD format, which matches the varchar date in HOSoffice
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    
    // Reset cache daily to prevent memory growth
    if (today !== currentTodayStr) {
      currentTodayStr = today;
      processingScans.clear();
    }
    
    // 1. Fetch unprocessed scans for today (is_notified = 1 or 2)
    const [scans] = await hosofficePool.query(`
      SELECT 
        h.EmployeeID, 
        h.AccessDate, 
        h.AccessTime, 
        h.Direction, 
        h.DeviceName,
        h.ReaderName,
        h.SkinSurfaceTemperature,
        h.AttendanceStatus,
        h.AuthenticationResult,
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as fullname
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
        AND (NULLIF(TRIM(p.LINE_YOUR_USER_ID), '') IS NOT NULL OR NULLIF(TRIM(p.TELEGRAM_CHAT_ID), '') IS NOT NULL)
      ORDER BY h.AccessTime ASC
      LIMIT 10
    `, [today]);

    // 2. Do not retry scans that cannot be associated with a notification channel.
    await hosofficePool.query(`
      UPDATE hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      SET h.is_notified = 3
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
        AND (p.FINGLE_ID IS NULL OR (NULLIF(TRIM(p.LINE_YOUR_USER_ID), '') IS NULL AND NULLIF(TRIM(p.TELEGRAM_CHAT_ID), '') IS NULL))
    `, [today]);

    if (scans.length === 0) return;

    console.log(`[RealtimeNotifier] Found ${scans.length} unprocessed scans to notify.`);

    for (const scan of scans) {
      const { EmployeeID, AccessDate, AccessTime, Direction, DeviceName, ReaderName, SkinSurfaceTemperature, AttendanceStatus, AuthenticationResult, line_user_id, telegram_chat_id, fullname } = scan;

      // Keep concurrent poll iterations from handling the same scan at once. Durable state
      // and retry timing are stored in notification_deliveries, not this in-memory set.
      const scanKey = `${EmployeeID}_${AccessDate}_${AccessTime}`;
      if (processingScans.has(scanKey)) {
        continue;
      }
      processingScans.add(scanKey);

      try {
        await pool.query(
          `INSERT IGNORE INTO notification_deliveries (employee_id, access_date, access_time, next_attempt_at)
           VALUES (?, ?, ?, NOW())`,
          [EmployeeID, AccessDate, AccessTime]
        );
        const [deliveryRows] = await pool.query(
          'SELECT status, attempts, next_attempt_at FROM notification_deliveries WHERE employee_id = ? AND access_date = ? AND access_time = ?',
          [EmployeeID, AccessDate, AccessTime]
        );
        const delivery = deliveryRows[0];
        if (!delivery) continue;
        if (delivery.status === 'sent') {
          await hosofficePool.query('UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, AccessDate, AccessTime]);
          continue;
        }
        if (delivery.status === 'failed' || (delivery.next_attempt_at && new Date(delivery.next_attempt_at) > new Date())) continue;

        // Bypass actual sending if disabled in configuration
        if (process.env.ENABLE_REALTIME_NOTIFICATIONS === 'false') {
          console.log(`[RealtimeNotifier] Real-time notifications are disabled in .env. Skipping push to ${fullname || EmployeeID} (${EmployeeID}).`);
          await pool.query(
            `UPDATE notification_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), last_error = NULL WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            [EmployeeID, AccessDate, AccessTime]
          );
          await hosofficePool.query('UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, AccessDate, AccessTime]);
          continue;
        }

        const directionThai = getStatusLabel(AttendanceStatus, AuthenticationResult, Direction);

        const location = DeviceName || 'ไม่ระบุจุดสแกน';
        const dateThai = new Date(AccessDate).toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const isLateScan = (Direction === 'in' || Direction === 'i' || AttendanceStatus === 'i') && (AccessTime > '08:31:00');
        const lineFlexContents = flexBuilder.buildAttendanceFlex({
          fullname: fullname || EmployeeID,
          employeeId: EmployeeID,
          direction: Direction,
          attendanceStatus: AttendanceStatus,
          authResult: AuthenticationResult,
          dateThai,
          timeStr: AccessTime,
          deviceName: location,
          temperature: SkinSurfaceTemperature,
          isLate: isLateScan
        });

        let message = `🕒 *บันทึกเวลาปฏิบัติงาน*\n\n` +
                      `👤 พนักงาน: ${fullname || EmployeeID}\n` +
                      `📋 สถานะ: ${directionThai}\n` +
                      `⏰ เวลา: ${AccessTime} น.\n` +
                      `📅 วันที่: ${dateThai}\n` +
                      `🚪 จุดบันทึก: ${location}`;

        if (SkinSurfaceTemperature && SkinSurfaceTemperature.trim() !== '') {
          message += `\n🌡️ อุณหภูมิ: ${SkinSurfaceTemperature} °C`;
        }

        const result = await NotificationService.sendDirectNotification(line_user_id, telegram_chat_id, message, undefined, lineFlexContents);
        if (result.success) {
          await pool.query(
            `UPDATE notification_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), next_attempt_at = NULL, last_error = NULL
             WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            [EmployeeID, AccessDate, AccessTime]
          );
          await hosofficePool.query('UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, AccessDate, AccessTime]);
          console.log(`[RealtimeNotifier] Successfully sent notification to ${fullname || EmployeeID} (${EmployeeID}). LINE: ${result.line}, Telegram: ${result.telegram}`);
        } else {
          const attempts = Number(delivery.attempts) + 1;
          const terminal = attempts >= 5;
          const retryMinutes = Math.min(2 ** attempts, 60);
          await pool.query(
            `UPDATE notification_deliveries
             SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ${terminal ? 'NULL' : 'DATE_ADD(NOW(), INTERVAL ? MINUTE)'}
             WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            terminal
              ? ['failed', attempts, 'LINE and Telegram delivery failed', EmployeeID, AccessDate, AccessTime]
              : ['pending', attempts, 'LINE and Telegram delivery failed', retryMinutes, EmployeeID, AccessDate, AccessTime]
          );
          if (terminal) {
            await hosofficePool.query('UPDATE hikvision SET is_notified = 4 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, AccessDate, AccessTime]);
          }
          console.error(`[RealtimeNotifier] Delivery failed for ${fullname || EmployeeID} (${EmployeeID}); attempt ${attempts}/5.`);
        }
      } finally {
        processingScans.delete(scanKey);
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
