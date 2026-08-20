require('dotenv').config();
const NotificationService = require('../../src/services/notificationService');
const flexBuilder = require('../../src/services/flexBuilder');

async function testLineFlex() {
  const lineUserId = process.argv[2] || process.env.LINE_ADMIN_USER_ID;
  const statusArg = (process.argv[3] || 'check-in').toLowerCase();

  if (!lineUserId) {
    console.error('❌ Error: LINE_ADMIN_USER_ID is not configured in .env and no User ID was provided.');
    process.exit(1);
  }

  console.log(`Sending test LINE Flex Message (${statusArg}) to User ID: ${lineUserId}...`);

  const now = new Date();
  const dateThai = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const messageText = `🕒 *บันทึกเวลาปฏิบัติงาน (TEST)*\n\n👤 พนักงาน: คุณกิตติพันธ์ ปรางศรี\n📋 สถานะ: ${statusArg}\n⏰ เวลา: ${timeStr} น.`;

  let direction = 'in';
  let attendanceStatus = 'i';
  let isLate = false;
  let authResult = 'Success';

  if (statusArg === 'check-out' || statusArg === 'out') {
    direction = 'out';
    attendanceStatus = 'o';
  } else if (statusArg === 'late') {
    direction = 'in';
    attendanceStatus = 'i';
    isLate = true;
  } else if (statusArg === 'failed') {
    authResult = 'Failed';
  }

  const lineFlexContents = flexBuilder.buildAttendanceFlex({
    fullname: 'คุณกิตติพันธ์ ปรางศรี (ทดสอบ)',
    employeeId: 'KHH-8921',
    direction,
    attendanceStatus,
    authResult,
    dateThai,
    timeStr,
    deviceName: 'KHHin2 (ประตูหน้าหลัก)',
    temperature: '36.5',
    isLate
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
