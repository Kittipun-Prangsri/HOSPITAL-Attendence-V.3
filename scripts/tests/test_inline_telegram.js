require('dotenv').config();
const NotificationService = require('../../src/services/notificationService');

async function runTest() {
  const testChatId = process.argv[2] || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!testChatId) {
    console.error('❌ Error: Please specify a Telegram Chat ID as an argument or set TELEGRAM_ADMIN_CHAT_ID in .env.');
    process.exit(1);
  }

  console.log(`Sending job alert to Telegram Chat ID: ${testChatId}...`);

  const messageText = `🚨 *แจ้งเตือนด่วน!*\n\n*แผนก:* ตึกผู้ป่วยใน ชั้น 4\n*รายละเอียด:* ตรวจพบความผิดปกติ\n\nกรุณาตรวจสอบหน้างานทันที`;
  
  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '✅ รับทราบ/ไปที่งาน',
            callback_data: 'confirm_job_123'
          }
        ]
      ]
    }
  };

  const success = await NotificationService.sendDirectTelegram(testChatId, messageText, options);
  if (success) {
    console.log('✅ Job alert sent successfully with inline keyboard!');
  } else {
    console.error('❌ Failed to send job alert message.');
  }

  // Keep process alive for 15 seconds to allow clicking the button and testing the callback handler
  console.log('Waiting 15 seconds for button clicks/interactions...');
  await new Promise(resolve => setTimeout(resolve, 15000));
  process.exit(0);
}

runTest();
