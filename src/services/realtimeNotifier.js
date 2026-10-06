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
    // Sv-SE locale returns YYYY-MM-DD format, which matches the varchar date in HOSoffice
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

    // Reset cache daily to prevent memory growth
    if (today !== currentTodayStr) {
      currentTodayStr = today;
      processingScans.clear();
    }

    // 1. Discover today's brand-new scans (is_notified = 1 or 2) and register them
    // in notification_deliveries so they enter the delivery queue below.
    const [newScans] = await hosofficePool.query(`
      SELECT h.EmployeeID, h.AccessDate, h.AccessTime
      FROM hikvision h
      WHERE h.AccessDate = ?
        AND h.is_notified IN (1, 2)
    `, [today]);
    for (const s of newScans) {
      const dateStr = typeof s.AccessDate === 'string'
        ? s.AccessDate.slice(0, 10)
        : (s.AccessDate instanceof Date ? s.AccessDate.toISOString().slice(0, 10) : String(s.AccessDate));

      await pool.query(
        `INSERT IGNORE INTO notification_deliveries (employee_id, access_date, access_time, next_attempt_at)
         VALUES (?, ?, ?, NOW())`,
        [s.EmployeeID, dateStr, s.AccessTime]
      );

      // Immediately mark as notified in hikvision so the scan is never picked up repeatedly
      await hosofficePool.query(
        `UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?`,
        [s.EmployeeID, dateStr, s.AccessTime]
      );
    }

    // 2. Fetch scans actually due for a send/retry attempt right now, driven off
    // notification_deliveries (not hikvision.AccessDate). This is what the old
    // code got wrong: it only ever looked at *today's* hikvision rows, so any
    // delivery still retrying when the day rolled over was never queried again —
    // it sat at status='pending' forever, invisible to the admin "failed" view.
    // Scoping by delivery status/next_attempt_at instead of by date means a scan
    // from any day keeps getting retried until it truly succeeds or goes terminal,
    // and — since this table only ever holds scans that were actually queued —
    // it stays small regardless of how far back a stuck record dates.
    // It also fixes head-of-line blocking: the old query pulled the oldest 10
    // hikvision rows regardless of whether their backoff had elapsed, so 10 scans
    // stuck mid-backoff could crowd out newer ones for up to an hour. Filtering
    // next_attempt_at in SQL means LIMIT 10 only ever returns scans ready to send.
    const [scans] = await pool.query(`
      SELECT d.employee_id AS EmployeeID, d.access_date AS AccessDate, d.access_time AS AccessTime,
             d.status AS deliveryStatus, d.attempts AS deliveryAttempts
      FROM notification_deliveries d
      WHERE d.status = 'pending'
        AND d.access_date >= ?
        AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
      ORDER BY d.access_date DESC, d.access_time DESC
      LIMIT 10
    `, [today]);

    if (scans.length === 0) return;

    // Enrich with scan/employee details from HOSoffice, joined by the natural key.
    const detailPromises = scans.map(async (s) => {
      const dateStr = typeof s.AccessDate === 'string'
        ? s.AccessDate.slice(0, 10)
        : (s.AccessDate instanceof Date ? s.AccessDate.toISOString().slice(0, 10) : String(s.AccessDate));

      const [hrRows] = await hosofficePool.query(`
        SELECT p.LINE_YOUR_USER_ID as line_user_id,
               p.TELEGRAM_CHAT_ID as telegram_chat_id,
               NULLIF(TRIM(CONCAT(COALESCE(TRIM(p.HR_FNAME),''), ' ', COALESCE(TRIM(p.HR_LNAME),''))), '') as hr_fullname
        FROM hr_person p
        WHERE p.FINGLE_ID = ? OR CAST(p.ID AS CHAR) = ? OR p.HR_CID = ? OR p.PERMIS_ID = ?
        LIMIT 1
      `, [s.EmployeeID, s.EmployeeID, s.EmployeeID, s.EmployeeID]);

      const [hikRows] = await hosofficePool.query(`
        SELECT h.Direction, h.DeviceName, h.ReaderName, h.SkinSurfaceTemperature,
               h.AttendanceStatus, h.AuthenticationResult, h.PersonName
        FROM hikvision h
        WHERE h.EmployeeID = ? AND (h.AccessDate = ? OR h.AccessDate LIKE ?) AND h.AccessTime = ?
        LIMIT 1
      `, [s.EmployeeID, dateStr, `${dateStr}%`, s.AccessTime]);

      const hr = hrRows[0] || {};
      const hik = hikRows[0] || {};

      const fullname = hr.hr_fullname || (hik.PersonName && !hik.PersonName.includes('เธ') ? hik.PersonName : s.EmployeeID);

      return {
        ...hik,
        line_user_id: hr.line_user_id,
        telegram_chat_id: hr.telegram_chat_id,
        fullname
      };
    });
    const detailResults = await Promise.all(detailPromises);
    for (let i = 0; i < scans.length; i++) {
      Object.assign(scans[i], detailResults[i] || {});
    }

    console.log(`[RealtimeNotifier] Found ${scans.length} scans due for a notification attempt.`);

    const newlyTerminalFailures = [];

    for (const scan of scans) {
      const { EmployeeID, AccessDate, AccessTime, deliveryAttempts, Direction, DeviceName, ReaderName, SkinSurfaceTemperature, AttendanceStatus, AuthenticationResult, line_user_id, telegram_chat_id, fullname } = scan;

      const dateStr = typeof AccessDate === 'string'
        ? AccessDate.slice(0, 10)
        : (AccessDate instanceof Date ? AccessDate.toISOString().slice(0, 10) : String(AccessDate));

      // Keep concurrent poll iterations from handling the same scan at once. Durable state
      // and retry timing are stored in notification_deliveries, not this in-memory set.
      const scanKey = `${EmployeeID}_${dateStr}_${AccessTime}`;
      if (processingScans.has(scanKey)) {
        continue;
      }
      processingScans.add(scanKey);

      try {
        // Bypass actual sending if disabled in configuration
        if (process.env.ENABLE_REALTIME_NOTIFICATIONS === 'false') {
          console.log(`[RealtimeNotifier] Real-time notifications are disabled in .env. Skipping push to ${fullname || EmployeeID} (${EmployeeID}).`);
          await pool.query(
            `UPDATE notification_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), last_error = NULL WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            [EmployeeID, dateStr, AccessTime]
          );
          await hosofficePool.query('UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, dateStr, AccessTime]);
          continue;
        }

        const directionThai = getStatusLabel(AttendanceStatus, AuthenticationResult, Direction);

        const location = DeviceName || 'ไม่ระบุจุดสแกน';

        let dateObj;
        if (typeof AccessDate === 'string') {
          dateObj = new Date(`${AccessDate.slice(0, 10)}T00:00:00+07:00`);
        } else {
          dateObj = new Date(AccessDate);
        }

        const dateThai = dateObj.toLocaleDateString('th-TH', {
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const dirLower = (Direction || '').toLowerCase();
        const statusLower = (AttendanceStatus || '').toLowerCase();
        const isCheckIn = dirLower === 'in' || dirLower === 'i' || statusLower === 'in' || statusLower === 'i' || statusLower === 'check-in';
        const isLateScan = isCheckIn && (AccessTime > '08:31:00');
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

        const statusText = getStatusLabel(AttendanceStatus, AuthenticationResult, Direction, isLateScan);
        const rawName = (fullname || EmployeeID).trim();
        const displayName = rawName.startsWith('คุณ') ? rawName : `คุณ${rawName}`;

        const message = `${displayName} — ${statusText} (${AccessTime} น.)`;

        const validEmpTelegram = telegram_chat_id && /^-?\d+$/.test(String(telegram_chat_id).trim()) ? String(telegram_chat_id).trim() : null;
        const targetTelegram = validEmpTelegram || process.env.TELEGRAM_ADMIN_CHAT_ID;
        const result = await NotificationService.sendDirectNotification(line_user_id, targetTelegram, message, undefined, lineFlexContents);

        // Also send copy to Telegram Admin if employee has their own distinct Telegram ID
        if (validEmpTelegram && process.env.TELEGRAM_ADMIN_CHAT_ID && validEmpTelegram !== process.env.TELEGRAM_ADMIN_CHAT_ID) {
          await NotificationService.sendDirectTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, message);
        }
        if (result.success) {
          await pool.query(
            `UPDATE notification_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), next_attempt_at = NULL, last_error = NULL
             WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            [EmployeeID, dateStr, AccessTime]
          );
          await hosofficePool.query('UPDATE hikvision SET is_notified = 3 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, dateStr, AccessTime]);
          console.log(`[RealtimeNotifier] Successfully sent notification to ${fullname || EmployeeID} (${EmployeeID}). LINE: ${result.line}, Telegram: ${result.telegram}`);
        } else {
          const attempts = Number(deliveryAttempts) + 1;
          const terminal = attempts >= 5;
          const retryMinutes = Math.min(2 ** attempts, 60);
          await pool.query(
            `UPDATE notification_deliveries
             SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ${terminal ? 'NULL' : 'DATE_ADD(NOW(), INTERVAL ? MINUTE)'}
             WHERE employee_id = ? AND access_date = ? AND access_time = ?`,
            terminal
              ? ['failed', attempts, 'LINE and Telegram delivery failed', EmployeeID, dateStr, AccessTime]
              : ['pending', attempts, 'LINE and Telegram delivery failed', retryMinutes, EmployeeID, dateStr, AccessTime]
          );
          if (terminal) {
            await hosofficePool.query('UPDATE hikvision SET is_notified = 4 WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?', [EmployeeID, dateStr, AccessTime]);
            newlyTerminalFailures.push({ fullname: fullname || EmployeeID, employeeId: EmployeeID, accessDate: dateStr, accessTime: AccessTime });
          }
          console.error(`[RealtimeNotifier] Delivery failed for ${fullname || EmployeeID} (${EmployeeID}); attempt ${attempts}/5.`);
        }
      } finally {
        processingScans.delete(scanKey);
      }
    }

    // One batched admin alert per poll cycle (not one per failure) so a run of
    // simultaneous bad chat IDs doesn't flood the admin channel — each cycle is
    // capped at LIMIT 10 scans, so this is naturally bounded too.
    if (newlyTerminalFailures.length > 0) {
      const lines = newlyTerminalFailures
        .map(f => {
          const dateStr = f.accessDate instanceof Date ? f.accessDate.toISOString().slice(0, 10) : f.accessDate;
          return `• ${f.fullname} (${f.employeeId}) — ${dateStr} ${f.accessTime}`;
        })
        .join('\n');
      const adminMsg = `⚠️ *แจ้งเตือนระบบส่งข้อความล้มเหลว*\n\n` +
        `พบการแจ้งเตือนเข้า-ออกงานที่ส่งไม่สำเร็จหลัง retry ครบ 5 ครั้ง จำนวน ${newlyTerminalFailures.length} รายการ:\n\n${lines}\n\n` +
        `กรุณาตรวจสอบ LINE/Telegram ID ของบุคลากรที่หน้า admin > จัดการผู้ใช้ > แท็บ "แจ้งเตือนล้มเหลว"`;
      await NotificationService.sendToAdmin(adminMsg);
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
