const NotificationService = require('../../src/services/notificationService');

async function testLinePush() {
  const lineUserId = 'U285bfba33061c6d1f435db9e55b09a91';
  const testMessage = '🔔 ทดสอบการแจ้งเตือนจากระบบบันทึกเวลาทำงาน KHH';
  
  console.log(`Sending test LINE message to ${lineUserId}...`);
  try {
    const success = await NotificationService.sendDirectLine(lineUserId, testMessage);
    if (success) {
      console.log('✅ LINE message sent successfully!');
    } else {
      console.log('❌ LINE message failed (unknown issue, check token).');
    }
  } catch (err) {
    console.error('❌ Captured error:', err);
  } finally {
    process.exit(0);
  }
}

testLinePush();
