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
  
  const { createAttendanceFlex } = require('../../src/utils/flexMessageBuilder');

  const lineFlexContents = createAttendanceFlex({
    fullname: 'คุณกิตติพันธ์ ปรางศรี (ทดสอบ)',
    employeeId: 'EMP-999',
    statusLabel: '✅ เข้างานปกติ (Check-in)',
    direction: 'in',
    isLate: false,
    timeStr: '08:25',
    dateStr: '20 สิงหาคม 2026',
    deviceName: 'KHHin2 (อาคารหลัก)'
  });

  const result = await NotificationService.sendDirectNotification(lineUserId, null, messageText, {}, lineFlexContents);
  if (result.success) {
    console.log('✅ LINE Flex Message sent successfully!');
  } else {
    console.error('❌ Failed to send LINE Flex Message. Please check your LINE token and ID in .env.');
  }

  process.exit(0);
}

testLineFlex();
