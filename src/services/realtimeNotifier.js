const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('./notificationService');
const flexBuilder = require('./flexBuilder');

let intervalId = null;
const processingScans = new Set();
let currentTodayStr = null;

function getStatusLabel(attendanceStatus, authResult, direction, isLate = false) {
  if (authResult === 'Failed' || authResult === 'FAILED' || authResult === 'Denied') {
    return 'สแกนไม่ผ่าน';
  }
  if (isLate) {
    return 'เข้างานสาย';
  }

  const status = (attendanceStatus || direction || '').toLowerCase();
  switch (status) {
    case 'i':
    case 'in':
    case 'check-in':
      return 'สแกนเข้างาน';
    case 'o':
    case 'out':
    case 'check-out':
      return 'สแกนออกงาน';
    default:
      return 'สแกนเข้างาน';
  }
}

async function checkNewScans() {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

    if (today !== currentTodayStr) {
      currentTodayStr = today;
      processingScans.clear();
    }

    // Discover today's brand-new scans (is_notified = 1 or 2)
    const [scans] = await hosofficePool.query(`
      SELECT h.EmployeeID, h.AccessDate, h.AccessTime, h.Direction, h.DeviceName,
             h.ReaderName, h.SkinSurfaceTemperature, h.AttendanceStatus, h.AuthenticationResult, h.PersonName
      FROM hikvision h
      WHERE h.AccessDate = ?
        AND h.is_notified IN (1, 2)
      ORDER BY h.AccessTime ASC
      LIMIT 10
    `, [today]);

    if (scans.length === 0) return;

    for (const scan of scans) {
      const dateStr = typeof scan.AccessDate === 'string'
        ? scan.AccessDate.slice(0, 10)
        : (scan.AccessDate instanceof Date ? scan.AccessDate.toISOString().slice(0, 10) : String(scan.AccessDate));

      const scanKey = `${scan.EmployeeID}_${dateStr}_${scan.AccessTime}`;
      if (processingScans.has(scanKey)) {
        continue;
      }
      processingScans.add(scanKey);

      try {
        // Immediately mark as notified in hikvision so the scan is never processed again
        await hosofficePool.query(
          `UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?`,
          [scan.EmployeeID, dateStr, scan.AccessTime]
        );

        // Fetch HR person info for full name & channels
        const [hrRows] = await hosofficePool.query(`
          SELECT p.LINE_YOUR_USER_ID as line_user_id,
                 p.TELEGRAM_CHAT_ID as telegram_chat_id,
                 NULLIF(TRIM(CONCAT(COALESCE(TRIM(p.HR_FNAME),''), ' ', COALESCE(TRIM(p.HR_LNAME),''))), '') as hr_fullname
          FROM hr_person p
          WHERE p.FINGLE_ID = ? OR CAST(p.ID AS CHAR) = ? OR p.HR_CID = ? OR p.PERMIS_ID = ?
          LIMIT 1
        `, [scan.EmployeeID, scan.EmployeeID, scan.EmployeeID, scan.EmployeeID]);

        const hr = hrRows[0] || {};
        const fullname = hr.hr_fullname || (scan.PersonName && !scan.PersonName.includes('เธ') ? scan.PersonName : scan.EmployeeID);

        // Record initial delivery row
        await pool.query(
          `INSERT IGNORE INTO notification_deliveries (employee_id, access_date, access_time, status, attempts, sent_at)
           VALUES (?, ?, ?, 'pending', 1, NOW())`,
          [scan.EmployeeID, dateStr, scan.AccessTime]
        );

        if (process.env.ENABLE_REALTIME_NOTIFICATIONS === 'false') {
          console.log(`[RealtimeNotifier] Real-time notifications disabled in .env. Skipping push for ${fullname || scan.EmployeeID}.`);
          await pool.query(
            `UPDATE notification_deliveries SET status = 'sent', sent_at = NOW() WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            [scan.EmployeeID, dateStr, scan.AccessTime]
          );
          continue;
        }

        const dirLower = (scan.Direction || '').toLowerCase();
        const statusLower = (scan.AttendanceStatus || '').toLowerCase();
        const isCheckIn = dirLower === 'in' || dirLower === 'i' || statusLower === 'in' || statusLower === 'i' || statusLower === 'check-in';
        const isLateScan = isCheckIn && (scan.AccessTime > '08:31:00');

        const statusText = getStatusLabel(scan.AttendanceStatus, scan.AuthenticationResult, scan.Direction, isLateScan);
        const rawName = (fullname || scan.EmployeeID).trim();
        const displayName = rawName.startsWith('คุณ') ? rawName : `คุณ${rawName}`;

        const message = `${displayName} — ${statusText} (${scan.AccessTime} น.)`;

        const location = scan.DeviceName || 'ไม่ระบุจุดสแกน';
        let dateObj = typeof scan.AccessDate === 'string'
          ? new Date(`${scan.AccessDate.slice(0, 10)}T00:00:00+07:00`)
          : new Date(scan.AccessDate);

        const dateThai = dateObj.toLocaleDateString('th-TH', {
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const lineFlexContents = flexBuilder.buildAttendanceFlex({
          fullname: fullname || scan.EmployeeID,
          employeeId: scan.EmployeeID,
          direction: scan.Direction,
          attendanceStatus: scan.AttendanceStatus,
          authResult: scan.AuthenticationResult,
          dateThai,
          timeStr: scan.AccessTime,
          deviceName: location,
          temperature: scan.SkinSurfaceTemperature,
          isLate: isLateScan
        });

        const telegramCardMessage = flexBuilder.buildTelegramCard({
          fullname: fullname || scan.EmployeeID,
          employeeId: scan.EmployeeID,
          direction: scan.Direction,
          attendanceStatus: scan.AttendanceStatus,
          authResult: scan.AuthenticationResult,
          dateThai,
          timeStr: scan.AccessTime,
          deviceName: location,
          temperature: scan.SkinSurfaceTemperature,
          isLate: isLateScan
        });

        const validEmpTelegram = hr.telegram_chat_id && /^-?\d+$/.test(String(hr.telegram_chat_id).trim()) ? String(hr.telegram_chat_id).trim() : null;
        const targetTelegram = validEmpTelegram || process.env.TELEGRAM_ADMIN_CHAT_ID;

        const result = await NotificationService.sendDirectNotification(hr.line_user_id, targetTelegram, telegramCardMessage, undefined, lineFlexContents);

        if (validEmpTelegram && process.env.TELEGRAM_ADMIN_CHAT_ID && validEmpTelegram !== process.env.TELEGRAM_ADMIN_CHAT_ID) {
          await NotificationService.sendDirectTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, telegramCardMessage, { parse_mode: 'Markdown' });
        }

        const deliveryStatus = result.success ? 'sent' : 'failed';
        await pool.query(
          `UPDATE notification_deliveries SET status = ?, sent_at = NOW(), last_error = ? WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
          [deliveryStatus, result.success ? null : 'Delivery failed', scan.EmployeeID, dateStr, scan.AccessTime]
        );

        console.log(`[RealtimeNotifier] Real-time notification sent for ${displayName} (${scan.EmployeeID}): ${deliveryStatus}. LINE: ${result.line}, Telegram: ${result.telegram}`);

        // 350ms delay between notifications to prevent Telegram 429 rate limit
        await new Promise(resolve => setTimeout(resolve, 350));
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
