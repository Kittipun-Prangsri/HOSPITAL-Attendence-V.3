/**
 * ส่งแจ้งเตือน Flex Message ไปยัง LINE ของบุคลากรรายบุคคล
 * 
 * @param {string} userId - LINE User ID ผู้รับข้อความ
 * @param {string} employeeName - ชื่อ-นามสกุลพนักงาน
 * @param {string} status - สถานะการสแกน เช่น "เข้างาน (Check-in)" หรือ "ออกงาน (Check-out)"
 * @param {string} time - วันที่และเวลาที่สแกน เช่น "05 มิถุนายน 2026, 09:53 น."
 * @param {string} [location] - จุดสแกน/จุดบันทึกเวลา
 */
function sendFlexMessage(userId, employeeName, status, time, location) {
  var url = 'https://api.line.me/v2/bot/message/push';
  
  // TODO: ใส่ Channel Access Token ของ LINE Messaging API ของคุณที่นี่
  var token = 'YOUR_CHANNEL_ACCESS_TOKEN'; 

  var loc = location || 'ไม่ระบุจุดบันทึก';

  var payload = {
    "to": userId,
    "messages": [{
      "type": "flex",
      "altText": "แจ้งเตือนการสแกนเข้า-ออกงาน",
      "contents": {
        "type": "bubble",
        "size": "mega",
        "header": {
          "type": "box",
          "layout": "vertical",
          "contents": [
            {
              "type": "text",
              "text": "ATTENDANCE LOG",
              "color": "#FFFFFF",
              "size": "xs",
              "weight": "bold",
              "align": "center"
            },
            {
              "type": "text",
              "text": "บันทึกเวลาปฏิบัติงาน",
              "color": "#FFFFFF",
              "size": "lg",
              "weight": "bold",
              "margin": "sm",
              "align": "center"
            }
          ],
          "paddingTop": "25px",
          "paddingBottom": "25px",
          "backgroundColor": "#FF0099"
        },
        "hero": {
          "type": "image",
          "url": "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
          "size": "full",
          "aspectRatio": "3:1",
          "aspectMode": "cover",
          "gravity": "center"
        },
        "body": {
          "type": "box",
          "layout": "vertical",
          "contents": [
            {
              "type": "text",
              "text": employeeName,
              "weight": "bold",
              "size": "xl",
              "align": "center",
              "color": "#333333"
            },
            {
              "type": "box",
              "layout": "vertical",
              "margin": "xxl",
              "spacing": "sm",
              "contents": [
                {
                  "type": "box",
                  "layout": "baseline",
                  "contents": [
                    {
                      "type": "text",
                      "text": "สถานะ",
                      "color": "#aaaaaa",
                      "size": "sm",
                      "flex": 1,
                      "align": "start"
                    },
                    {
                      "type": "text",
                      "text": status,
                      "color": "#FF0099",
                      "size": "sm",
                      "flex": 3,
                      "weight": "bold",
                      "margin": "lg"
                    }
                  ]
                },
                {
                  "type": "box",
                  "layout": "baseline",
                  "contents": [
                    {
                      "type": "text",
                      "text": "เวลา",
                      "color": "#aaaaaa",
                      "size": "sm",
                      "flex": 1,
                      "align": "start"
                    },
                    {
                      "type": "text",
                      "text": time,
                      "color": "#555555",
                      "size": "sm",
                      "flex": 3,
                      "margin": "lg"
                    }
                  ]
                },
                {
                  "type": "box",
                  "layout": "baseline",
                  "contents": [
                    {
                      "type": "text",
                      "text": "จุดบันทึก",
                      "color": "#aaaaaa",
                      "size": "sm",
                      "flex": 1,
                      "align": "start"
                    },
                    {
                      "type": "text",
                      "text": loc,
                      "color": "#555555",
                      "size": "sm",
                      "flex": 3,
                      "margin": "lg"
                    }
                  ]
                }
              ]
            }
          ]
        },
        "footer": {
          "type": "box",
          "layout": "horizontal",
          "spacing": "md",
          "contents": [
            {
              "type": "button",
              "action": {
                "type": "uri",
                "label": "ดูประวัติ",
                "uri": "https://your-hospital-url.com/profile" // TODO: ใส่ URL เว็บไซต์ระบบประวัติของคุณที่นี่
              },
              "style": "primary",
              "color": "#FF0099"
            },
            {
              "type": "button",
              "action": {
                "type": "uri",
                "label": "แจ้งเหตุฉุกเฉิน",
                "uri": "https://line.me" // TODO: ใส่ลิงก์แจ้งเหตุฉุกเฉินของคุณที่นี่
              },
              "style": "secondary",
              "color": "#FF0099"
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
