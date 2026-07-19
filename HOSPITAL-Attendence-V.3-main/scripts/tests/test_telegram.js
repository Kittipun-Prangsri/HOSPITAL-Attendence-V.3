require('dotenv').config();
const { hosofficePool } = require('../../src/config/db');
const NotificationService = require('../../src/services/notificationService');

async function runTest() {
  console.log('=== Starting Telegram Integration Test ===');
  
  // 1. Check database column
  try {
    const [columns] = await hosofficePool.query("SHOW COLUMNS FROM hr_person LIKE 'TELEGRAM_CHAT_ID'");
    if (columns.length > 0) {
      console.log('✅ DB Verification: TELEGRAM_CHAT_ID column exists in hr_person table.');
    } else {
      console.log('❌ DB Verification: TELEGRAM_CHAT_ID column does NOT exist in hr_person table.');
      console.log('   Starting the app once should automatically create it.');
    }
  } catch (err) {
    console.error('❌ DB Verification Failed:', err.message);
  }

  // 2. Check bot token configuration
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || botToken === 'dummy_token') {
    console.log('❌ Config Verification: TELEGRAM_BOT_TOKEN is not set or is using dummy_token in .env.');
    process.exit(1);
  } else {
    console.log('✅ Config Verification: TELEGRAM_BOT_TOKEN is configured.');
  }

  // 3. Test sending a message if chat ID is provided as argument
  const testChatId = process.argv[2] || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!testChatId) {
    console.log('\n💡 Tip: You can test sending a message by running:');
    console.log('   node scripts/tests/test_telegram.js <your_telegram_chat_id>');
    console.log('   Or by setting TELEGRAM_ADMIN_CHAT_ID in your .env file.');
  } else {
    console.log(`\nSending test Telegram message to Chat ID: ${testChatId}...`);
    const success = await NotificationService.sendDirectTelegram(
      testChatId,
      '🔔 *KHH Attendance Telegram Test*\n\nนี่คือข้อความทดสอบเพื่อยืนยันว่าการตั้งค่า Telegram ทำงานร่วมกับระบบบันทึกเวลาสำเร็จแล้ว!'
    );
    if (success) {
      console.log('✅ Test message sent successfully!');
    } else {
      console.log('❌ Failed to send test message. Check your bot token and chat ID.');
    }
  }

  process.exit(0);
}

runTest();
