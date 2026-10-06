const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('./notificationService');
const flexBuilder = require('./flexBuilder');

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

    // 1. Discover today's brand-new scans (is_notified = 1 or 2) and register them
    // in notification_deliveries so they enter the retry queue below. Scoped to
    // "today" purely to keep this discovery scan cheap — it only ever needs to see
    // scans as they land.
    const [newScans] = await hosofficePool.query(`
      SELECT h.EmployeeID, h.AccessDate, h.AccessTime
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ?
        AND h.is_notified IN (1, 2)
        AND (NULLIF(TRIM(p.LINE_YOUR_USER_ID), '') IS NOT NULL OR NULLIF(TRIM(p.TELEGRAM_CHAT_ID), '') IS NOT NULL)
    `, [today]);
    for (const s of newScans) {
      await pool.query(
        `INSERT IGNORE INTO notification_deliveries (employee_id, access_date, access_time, next_attempt_at)
         VALUES (?, ?, ?, NOW())`,
        [s.EmployeeID, s.AccessDate, s.AccessTime]
      );
    }

    // Do not retry scans that cannot be associated with a notification channel.
    await hosofficePool.query(`
      UPDATE hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      SET h.is_notified = 3
      WHERE h.AccessDate = ?
        AND h.is_notified IN (1, 2)
        AND (p.FINGLE_ID IS NULL OR (NULLIF(TRIM(p.LINE_YOUR_USER_ID), '') IS NULL AND NULLIF(TRIM(p.TELEGRAM_CHAT_ID), '') IS NULL))
    `, [today]);

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
      WHERE d.status = 'pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
      ORDER BY d.access_date ASC, d.access_time ASC
      LIMIT 10
    `);

    if (scans.length === 0) return;

    // Enrich with scan/employee details from HOSoffice, joined by the natural key.
    const detailPromises = scans.map(s => hosofficePool.query(`
      SELECT h.Direction, h.DeviceName, h.ReaderName, h.SkinSurfaceTemperature,
             h.AttendanceStatus, h.AuthenticationResult,
             p.LINE_YOUR_USER_ID as line_user_id, p.TELEGRAM_CHAT_ID as telegram_chat_id,
             CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as fullname
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.EmployeeID = ? AND h.AccessDate = ? AND h.AccessTime = ?
      LIMIT 1
    `, [s.EmployeeID, s.AccessDate, s.AccessTime]));
    const detailResults = await Promise.all(detailPromises);
    for (let i = 0; i < scans.length; i++) {
      Object.assign(scans[i], detailResults[i][0][0] || {});
    }

    console.log(`[RealtimeNotifier] Found ${scans.length} scans due for a notification attempt.`);

    const newlyTerminalFailures = [];

    for (const scan of scans) {
      const { EmployeeID, AccessDate, AccessTime, deliveryAttempts, Direction, DeviceName, ReaderName, SkinSurfaceTemperature, AttendanceStatus, AuthenticationResult, line_user_id, telegram_chat_id, fullname } = scan;

      // Keep concurrent poll iterations from handling the same scan at once. Durable state
      // and retry timing are stored in notification_deliveries, not this in-memory set.
      const scanKey = `${EmployeeID}_${AccessDate}_${AccessTime}`;
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
          const attempts = Number(deliveryAttempts) + 1;
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
            newlyTerminalFailures.push({ fullname: fullname || EmployeeID, employeeId: EmployeeID, accessDate: AccessDate, accessTime: AccessTime });
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
