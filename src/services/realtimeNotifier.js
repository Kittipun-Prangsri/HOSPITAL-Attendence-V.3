const { hosofficePool } = require('../config/db');
const NotificationService = require('./notificationService');

let intervalId = null;
const processedScans = new Set();
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
      processedScans.clear();
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
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as fullname
      FROM hikvision h
      INNER JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
      ORDER BY h.AccessTime ASC
      LIMIT 10
    `, [today]);

    // 2. Automatically mark scans of unregistered cards as notified (value 3)
    await hosofficePool.query(`
      UPDATE hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      SET h.is_notified = 3
      WHERE h.AccessDate = ? 
        AND h.is_notified IN (1, 2)
        AND p.FINGLE_ID IS NULL
    `, [today]);

    if (scans.length === 0) return;

    console.log(`[RealtimeNotifier] Found ${scans.length} unprocessed scans to notify.`);

    for (const scan of scans) {
      const { EmployeeID, AccessDate, AccessTime, Direction, DeviceName, ReaderName, SkinSurfaceTemperature, AttendanceStatus, AuthenticationResult, line_user_id, fullname } = scan;

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

      // Bypass actual sending if disabled in configuration
      if (process.env.ENABLE_REALTIME_NOTIFICATIONS === 'false') {
        console.log(`[RealtimeNotifier] Real-time notifications are disabled in .env. Skipping push to ${fullname || EmployeeID} (${EmployeeID}).`);
        continue;
      }

      const directionThai = getStatusLabel(AttendanceStatus, AuthenticationResult, Direction);

      const location = DeviceName || 'ไม่ระบุจุดสแกน';
      const dateThai = new Date(AccessDate).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
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

      const telegramOptions = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'ดูประวัติการเข้างาน',
                url: process.env.SYSTEM_URL ? `${process.env.SYSTEM_URL}/history` : 'https://your-hospital-system.com/history'
              }
            ]
          ]
        }
      };

      const lineFlexContents = {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "ATTENDANCE LOG",
              color: "#FFFFFF",
              size: "xs",
              weight: "bold",
              align: "center"
            },
            {
              type: "text",
              text: "บันทึกเวลาปฏิบัติงาน",
              color: "#FFFFFF",
              size: "lg",
              weight: "bold",
              margin: "sm",
              align: "center"
            }
          ],
          paddingTop: "25px",
          paddingBottom: "25px",
          backgroundColor: "#FF0099"
        },
        hero: {
          type: "image",
          url: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
          size: "full",
          aspectRatio: "3:1",
          aspectMode: "cover",
          gravity: "center"
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: fullname || EmployeeID,
              weight: "bold",
              size: "xl",
              align: "center",
              color: "#333333"
            },
            {
              type: "box",
              layout: "vertical",
              margin: "xxl",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  contents: [
                    {
                      type: "text",
                      text: "สถานะ",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      align: "start"
                    },
                    {
                      type: "text",
                      text: directionThai,
                      color: "#FF0099",
                      size: "sm",
                      flex: 3,
                      weight: "bold",
                      margin: "lg"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  contents: [
                    {
                      type: "text",
                      text: "เวลา",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      align: "start"
                    },
                    {
                      type: "text",
                      text: `${dateThai}, ${AccessTime} น.`,
                      color: "#555555",
                      size: "sm",
                      flex: 3,
                      margin: "lg"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  contents: [
                    {
                      type: "text",
                      text: "จุดบันทึก",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      align: "start"
                    },
                    {
                      type: "text",
                      text: location,
                      color: "#555555",
                      size: "sm",
                      flex: 3,
                      margin: "lg"
                    }
                  ]
                }
              ]
            }
          ]
        },
        footer: {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: "ดูประวัติ",
                uri: process.env.SYSTEM_URL ? `${process.env.SYSTEM_URL}/history` : 'https://your-hospital-system.com/history'
              },
              style: "primary",
              color: "#FF0099"
            },
            {
              type: "button",
              action: {
                type: "uri",
                label: "แจ้งเหตุฉุกเฉิน",
                uri: process.env.EMERGENCY_URL || "https://line.me"
              },
              style: "secondary",
              color: "#FF0099"
            }
          ]
        }
      };

      const targetTelegramChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '7857036135';

      // Send parallel / fallback notifications
      const result = await NotificationService.sendDirectNotification(line_user_id, targetTelegramChatId, message, telegramOptions, lineFlexContents);
      if (result.success) {
        console.log(`[RealtimeNotifier] Successfully sent notification to ${fullname || EmployeeID} (${EmployeeID}). LINE: ${result.line}, Telegram: ${result.telegram}`);
      } else {
        console.error(`[RealtimeNotifier] Failed to send notification to ${fullname || EmployeeID} (${EmployeeID}). Both services failed.`);
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
