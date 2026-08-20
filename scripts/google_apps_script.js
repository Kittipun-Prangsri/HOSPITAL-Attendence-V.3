/**
 * ส่งแจ้งเตือน Flex Message ไปยัง LINE ของบุคลากรรายบุคคล (Klong Hat Hospital)
 * 
 * @param {string} userId - LINE User ID ผู้รับข้อความ
 * @param {string} employeeName - ชื่อ-นามสกุลพนักงาน
 * @param {string} statusType - สถานะ: "check-in", "check-out", "late", หรือ "failed"
 * @param {string} timeStr - เวลา เช่น "09:53 น."
 * @param {string} dateThai - วันที่ เช่น "20 สิงหาคม 2026"
 * @param {string} [location] - จุดสแกน/จุดบันทึกเวลา
 */
function sendFlexMessage(userId, employeeName, statusType, timeStr, dateThai, location) {
  var url = 'https://api.line.me/v2/bot/message/push';
  var token = 'YOUR_CHANNEL_ACCESS_TOKEN'; // TODO: ใส่ Channel Access Token ของ LINE Messaging API ของคุณที่นี่

  var loc = location || 'ไม่ระบุจุดบันทึก';
  var type = (statusType || 'check-in').toLowerCase();

  // Dynamic themes based on status
  var themeMap = {
    'check-in': {
      headerBg: '#0D9488',
      subHeaderColor: '#CCFBF1',
      badgeBg: '#ECFDF5',
      badgeBorder: '#A7F3D0',
      badgeTextColor: '#047857',
      badgeIcon: '✅',
      statusTitle: 'สแกนเข้างาน (Check-In)',
      headerTag: 'ENTER • เข้างาน',
      btnColor: '#0D9488'
    },
    'check-out': {
      headerBg: '#0284C7',
      subHeaderColor: '#E0F2FE',
      badgeBg: '#F0F9FF',
      badgeBorder: '#BAE6FD',
      badgeTextColor: '#0369A1',
      badgeIcon: '📤',
      statusTitle: 'สแกนออกงาน (Check-Out)',
      headerTag: 'EXIT • ออกงาน',
      btnColor: '#0284C7'
    },
    'late': {
      headerBg: '#D97706',
      subHeaderColor: '#FEF3C7',
      badgeBg: '#FFFBEB',
      badgeBorder: '#FDE68A',
      badgeTextColor: '#B45309',
      badgeIcon: '⏰',
      statusTitle: 'เข้างานสาย (Late Arrival)',
      headerTag: 'LATE • เข้างานสาย',
      btnColor: '#D97706'
    },
    'failed': {
      headerBg: '#E11D48',
      subHeaderColor: '#FFE4E6',
      badgeBg: '#FEF2F2',
      badgeBorder: '#FECDD3',
      badgeTextColor: '#BE123C',
      badgeIcon: '❌',
      statusTitle: 'สแกนไม่ผ่าน (Scan Failed)',
      headerTag: 'FAILED • ไม่ผ่าน',
      btnColor: '#E11D48'
    }
  };

  var theme = themeMap[type] || themeMap['check-in'];
  var firstLetter = employeeName ? employeeName.trim().charAt(0).toUpperCase() : 'U';

  var payload = {
    "to": userId,
    "messages": [{
      "type": "flex",
      "altText": "แจ้งเตือนการสแกนเข้า-ออกงาน โรงพยาบาลคลองหาด",
      "contents": {
        "type": "bubble",
        "size": "mega",
        "header": {
          "type": "box",
          "layout": "vertical",
          "backgroundColor": theme.headerBg,
          "paddingTop": "20px",
          "paddingBottom": "20px",
          "paddingStart": "20px",
          "paddingEnd": "20px",
          "contents": [
            {
              "type": "text",
              "text": "KLONG HAT HOSPITAL • ATTENDANCE LOG",
              "color": theme.subHeaderColor,
              "size": "xxs",
              "weight": "bold",
              "align": "center"
            },
            {
              "type": "text",
              "text": "บันทึกเวลาปฏิบัติงาน",
              "color": "#FFFFFF",
              "size": "xl",
              "weight": "bold",
              "margin": "xs",
              "align": "center"
            },
            {
              "type": "text",
              "text": "[ " + theme.headerTag + " ]",
              "color": theme.subHeaderColor,
              "size": "xs",
              "margin": "xs",
              "align": "center"
            }
          ]
        },
        "body": {
          "type": "box",
          "layout": "vertical",
          "paddingAll": "20px",
          "contents": [
            {
              "type": "box",
              "layout": "horizontal",
              "spacing": "md",
              "alignItems": "center",
              "contents": [
                {
                  "type": "box",
                  "layout": "vertical",
                  "width": "46px",
                  "height": "46px",
                  "cornerRadius": "23px",
                  "backgroundColor": theme.headerBg,
                  "alignItems": "center",
                  "justifyContent": "center",
                  "contents": [
                    {
                      "type": "text",
                      "text": firstLetter,
                      "color": "#FFFFFF",
                      "size": "lg",
                      "weight": "bold",
                      "align": "center"
                    }
                  ]
                },
                {
                  "type": "box",
                  "layout": "vertical",
                  "flex": 1,
                  "contents": [
                    {
                      "type": "text",
                      "text": employeeName,
                      "weight": "bold",
                      "size": "md",
                      "color": "#0F172A",
                      "wrap": true
                    },
                    {
                      "type": "text",
                      "text": "บุคลากรโรงพยาบาล",
                      "size": "xs",
                      "color": "#64748B",
                      "margin": "xs"
                    }
                  ]
                }
              ]
            },
            {
              "type": "separator",
              "margin": "lg",
              "color": "#E2E8F0"
            },
            {
              "type": "box",
              "layout": "vertical",
              "margin": "lg",
              "backgroundColor": theme.badgeBg,
              "borderColor": theme.badgeBorder,
              "borderWidth": "1px",
              "cornerRadius": "12px",
              "paddingAll": "14px",
              "contents": [
                {
                  "type": "box",
                  "layout": "horizontal",
                  "alignItems": "center",
                  "spacing": "sm",
                  "contents": [
                    {
                      "type": "text",
                      "text": theme.badgeIcon,
                      "size": "md"
                    },
                    {
                      "type": "text",
                      "text": theme.statusTitle,
                      "color": theme.badgeTextColor,
                      "weight": "bold",
                      "size": "sm"
                    }
                  ]
                }
              ]
            },
            {
              "type": "box",
              "layout": "vertical",
              "margin": "lg",
              "backgroundColor": "#F8FAFC",
              "cornerRadius": "12px",
              "paddingAll": "14px",
              "contents": [
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "contents": [
                    { "type": "text", "text": "📅 วันที่", "size": "xs", "color": "#64748B", "flex": 2 },
                    { "type": "text", "text": dateThai || "วันนี้", "size": "xs", "color": "#1E293B", "weight": "bold", "flex": 4, "align": "end" }
                  ]
                },
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "margin": "md",
                  "contents": [
                    { "type": "text", "text": "⏰ เวลาบันทึก", "size": "xs", "color": "#64748B", "flex": 2 },
                    { "type": "text", "text": timeStr, "size": "xs", "color": "#1E293B", "weight": "bold", "flex": 4, "align": "end" }
                  ]
                },
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "margin": "md",
                  "contents": [
                    { "type": "text", "text": "🚪 จุดบันทึก", "size": "xs", "color": "#64748B", "flex": 2 },
                    { "type": "text", "text": loc, "size": "xs", "color": "#1E293B", "weight": "bold", "flex": 4, "align": "end", "wrap": true }
                  ]
                }
              ]
            }
          ]
        },
        "footer": {
          "type": "box",
          "layout": "vertical",
          "spacing": "sm",
          "paddingAll": "16px",
          "contents": [
            {
              "type": "button",
              "action": {
                "type": "uri",
                "label": "📋 ดูประวัติการเข้างาน",
                "uri": "https://your-hospital-url.com/history" // TODO: ใส่ URL เว็บไซต์ระบบประวัติของคุณที่นี่
              },
              "style": "primary",
              "color": theme.btnColor,
              "height": "sm"
            },
            {
              "type": "button",
              "action": {
                "type": "uri",
                "label": "📝 ยื่นใบลา / แจ้งเหตุสาย",
                "uri": "https://your-hospital-url.com/excuses" // TODO: ใส่ลิงก์แจ้งเหตุยื่นใบลาของคุณที่นี่
              },
              "style": "secondary",
              "color": theme.btnColor,
              "height": "sm"
            }
          ]
        }
      }
    }]
  };

  UrlFetchApp.fetch(url, {
    'method': 'post',
    'headers': { 'Authorization': 'Bearer ' + token },
    'contentType': 'application/json',
    'payload': JSON.stringify(payload)
  });
}
