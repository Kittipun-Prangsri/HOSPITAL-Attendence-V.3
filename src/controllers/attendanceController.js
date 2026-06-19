const NotificationService = require('../services/notificationService');
const { pool } = require('../config/db');

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
  const now = new Date();
  const currentTime = now.toTimeString().split(' ')[0]; // HH:MM:SS
  const lateThreshold = '08:31:00'; // Define threshold
  
  const isLate = currentTime > lateThreshold;
  
  try {
    // 1. Save to local attendance table
    const [result] = await pool.query(
      'INSERT INTO attendance (user_name, status, timestamp, is_late) VALUES (?, ?, ?, ?)',
      [userName, 'check-in', now, isLate]
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
  const now = new Date();
  const currentTime = now.toTimeString().split(' ')[0];

  try {
    await pool.query(
      'INSERT INTO attendance (user_name, status, timestamp, is_late) VALUES (?, ?, ?, ?)',
      [userName, 'check-out', now, false]
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

exports.logAttendance = async (req, res) => {
  const { employeeId, status, deviceName, attendanceStatus, authResult, authenticationResult } = req.body;
  const now = new Date();
  
  // Format current date and time in Thai timezone/format
  const currentTimeStr = now.toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' }).slice(0, 5); // HH:MM
  const dateThai = now.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Bangkok'
  });
  
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const time = now.toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });

  if (!employeeId || !status) {
    return res.status(400).json({ success: false, error: 'employeeId and status are required' });
  }

  try {
    // 1. Fetch employee details from HOSoffice DB hr_person
    const { hosofficePool } = require('../config/db');
    const [empRows] = await hosofficePool.query(
      "SELECT LINE_YOUR_USER_ID as line_user_id, TELEGRAM_CHAT_ID as telegram_chat_id, CONCAT(HR_FNAME, ' ', HR_LNAME) as fullname FROM hr_person WHERE FINGLE_ID = ? OR HR_CID = ?",
      [employeeId, employeeId]
    );

    if (empRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const { fullname, line_user_id } = empRows[0];

    const normalizedStatus = (status === 'in' || status === 'check-in') ? 'check-in' : 'check-out';
    const direction = normalizedStatus === 'check-in' ? 'in' : 'out';
    const isLate = normalizedStatus === 'check-in' && (now.toTimeString().split(' ')[0] > '08:31:00');
    
    // 2. Save to local attendance table
    await pool.query(
      'INSERT INTO attendance (user_name, status, timestamp, is_late) VALUES (?, ?, ?, ?)',
      [fullname, normalizedStatus, now, isLate]
    );

    // Resolve attendance status and authentication result
    let resolvedAttendanceStatus = attendanceStatus;
    if (!resolvedAttendanceStatus) {
      if (status === 'check-in' || status === 'in' || direction === 'in') {
        resolvedAttendanceStatus = 'i';
      } else if (status === 'check-out' || status === 'out' || direction === 'out') {
        resolvedAttendanceStatus = 'o';
      } else {
        resolvedAttendanceStatus = '';
      }
    }
    const resolvedAuthResult = authResult || authenticationResult || 'Success';

    // 3. Save to HOSoffice hikvision table
    const resolvedDeviceName = deviceName || 'Web/Manual';
    await hosofficePool.query(`
      INSERT INTO hikvision (
        EmployeeID, 
        AccessDateandTime, 
        AccessDate, 
        AccessTime, 
        AuthenticationResult, 
        AuthenticationType, 
        DeviceName, 
        PersonName, 
        Direction, 
        AttendanceStatus,
        is_notified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      employeeId,
      `${today}T${time}`,
      today,
      time,
      resolvedAuthResult,
      'API',
      resolvedDeviceName,
      fullname,
      direction,
      resolvedAttendanceStatus,
      3 // Mark as notified immediately since we send it below
    ]);

    // 4. Send Flex Message to LINE (and fallback/parallel Telegram to central group)
    const directionThai = getStatusLabel(resolvedAttendanceStatus, resolvedAuthResult, direction);

    // Plain text message fallback
    const plainMessage = `🕒 *บันทึกเวลาปฏิบัติงาน*\n\n` +
                         `👤 พนักงาน: ${fullname}\n` +
                         `📋 สถานะ: ${directionThai}\n` +
                         `⏰ เวลา: ${currentTimeStr} น.\n` +
                         `📅 วันที่: ${dateThai}\n` +
                         `🚪 จุดบันทึก: ${resolvedDeviceName}`;

    // LINE Flex Message structure
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
            text: fullname,
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
                    text: `${dateThai}, ${currentTimeStr} น.`,
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
                    text: resolvedDeviceName,
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

    const targetTelegramChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '7857036135';

    await NotificationService.sendDirectNotification(
      line_user_id,
      targetTelegramChatId,
      plainMessage,
      telegramOptions,
      lineFlexContents
    );

    res.status(200).send("Success");
  } catch (error) {
    console.error('Error in logAttendance API:', error.message);
    res.status(500).send(error.message);
  }
};
