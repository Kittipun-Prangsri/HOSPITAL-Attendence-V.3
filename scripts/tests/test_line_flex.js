require('dotenv').config();
const NotificationService = require('../../src/services/notificationService');

async function testLineFlex() {
  const lineUserId = process.argv[2] || process.env.LINE_ADMIN_USER_ID;
  if (!lineUserId) {
    console.error('❌ Error: LINE_ADMIN_USER_ID is not configured in .env and no User ID was provided.');
    process.exit(1);
  }

  console.log(`Sending test LINE Flex Message to User ID: ${lineUserId}...`);

  const messageText = `🕒 *บันทึกเวลาปฏิบัติงาน*\n\n👤 พนักงาน: คุณกิตติพันธ์ ปรางศรี (ทดสอบ)\n📋 สถานะ: เข้างาน (Check-in)\n⏰ เวลา: 10:30 น.`;
  
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
          text: "บันทึกเวลาปฏิบัติงาน (TEST)",
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
          text: "คุณกิตติพันธ์ ปรางศรี (ทดสอบ)",
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
                  text: "✅ เข้างาน (Check-in)",
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
                  text: "05 มิถุนายน 2026, 10:30 น.",
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
                  text: "KHHin2",
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

  const result = await NotificationService.sendDirectNotification(lineUserId, null, messageText, {}, lineFlexContents);
  if (result.success) {
    console.log('✅ LINE Flex Message sent successfully!');
  } else {
    console.error('❌ Failed to send LINE Flex Message. Please check your LINE token and ID in .env.');
  }

  process.exit(0);
}

testLineFlex();
