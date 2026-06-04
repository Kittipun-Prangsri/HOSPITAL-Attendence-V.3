require('dotenv').config();
const ChatbotService = require('../../src/services/chatbotService');

async function runTests() {
  console.log('🧪 Starting Chatbot Service Tests...\n');

  const testCases = [
    {
      name: "1. Today's scans command",
      message: "ขอดูการสแกนวันนี้"
    },
    {
      name: "1b. Today's scans command (typo: 'ขอดูแสกนวันนี้')",
      message: "ขอดูแสกนวันนี้"
    },
    {
      name: "1c. Today's scans command (no 'การ': 'ขอดูสแกนวันนี้')",
      message: "ขอดูสแกนวันนี้"
    },
    {
      name: "1d. Yesterday's scans command ('ขอดูแสกนเมื่อวาน')",
      message: "ขอดูแสกนเมื่อวาน"
    },
    {
      name: "1e. Yesterday's scans command ('ขอดูการสแกนเมื่อวาน')",
      message: "ขอดูการสแกนเมื่อวาน"
    },
    {
      name: "1f. Individual Today's query ('ขอดูแสกนวันนี้ กิตติพันธ์')",
      message: "ขอดูแสกนวันนี้ กิตติพันธ์"
    },
    {
      name: "1g. Individual Today's query ('ขอดูการสแกนวันนี้ ประยงค์')",
      message: "ขอดูการสแกนวันนี้ ประยงค์"
    },
    {
      name: "1h. Individual Yesterday's query ('ขอดูแสกนเมื่อวาน กิตติพันธ์')",
      message: "ขอดูแสกนเมื่อวาน กิตติพันธ์"
    },
    {
      name: "1i. EmployeeID query (Valid ID: 'ขอดูการสแกนวันนี้ KHH00108')",
      message: "ขอดูการสแกนวันนี้ KHH00108"
    },
    {
      name: "1j. EmployeeID query (Invalid ID: 'ขอดูการสแกนวันนี้ 99999')",
      message: "ขอดูการสแกนวันนี้ 99999"
    },
    {
      name: "1k. Shortcut 1 for global today's scans",
      message: "1"
    },
    {
      name: "1l. Shortcut 1 with EmployeeID ('1 KHH00108')",
      message: "1 KHH00108"
    },
    {
      name: "1m. Shortcut 1 with Name ('1 ประยงค์')",
      message: "1 ประยงค์"
    },
    {
      name: "1n. Shortcut 2 for global yesterday's scans",
      message: "2"
    },
    {
      name: "1o. Shortcut 2 with EmployeeID ('2 KHH00108')",
      message: "2 KHH00108"
    },
    {
      name: "1p. Shortcut 2 with Name ('2 ประยงค์')",
      message: "2 ประยงค์"
    },
    {
      name: "1q. Verbose yesterday command ('ขอดูย้อนหลังเมื่อวาน')",
      message: "ขอดูย้อนหลังเมื่อวาน"
    },
    {
      name: "1r. Verbose yesterday command with Name ('ขอดูย้อนหลังเมื่อวาน ประยงค์')",
      message: "ขอดูย้อนหลังเมื่อวาน ประยงค์"
    },
    {
      name: "1s. Shortcut 3 for global scans past 3 days",
      message: "3"
    },
    {
      name: "1t. Shortcut 3 with EmployeeID ('3 KHH00108')",
      message: "3 KHH00108"
    },
    {
      name: "1u. Shortcut 3 with Name ('3 ประยงค์')",
      message: "3 ประยงค์"
    },
    {
      name: "1v. Shortcut 7 for global scans past 7 days",
      message: "7"
    },
    {
      name: "1w. Shortcut 7 with EmployeeID ('7 KHH00108')",
      message: "7 KHH00108"
    },
    {
      name: "1x. Shortcut 7 with Name ('7 ประยงค์')",
      message: "7 ประยงค์"
    },
    {
      name: "1y. Thai range command ('ขอดูย้อนหลัง 3 วัน')",
      message: "ขอดูย้อนหลัง 3 วัน"
    },
    {
      name: "1z. English keyword command: scan_today (global)",
      message: "scan_today"
    },
    {
      name: "1aa. English keyword command: scan_today with EmployeeID ('scan_today KHH00108')",
      message: "scan_today KHH00108"
    },
    {
      name: "1ab. English keyword command: scan_yesterday (global)",
      message: "scan_yesterday"
    },
    {
      name: "1ac. English keyword command: scan_yesterday with EmployeeID ('scan_yesterday KHH00108')",
      message: "scan_yesterday KHH00108"
    },
    {
      name: "1ad. English keyword command: scan_3days (global)",
      message: "scan_3days"
    },
    {
      name: "1ae. English keyword command: scan_3days with EmployeeID ('scan_3days KHH00108')",
      message: "scan_3days KHH00108"
    },
    {
      name: "1af. English keyword command: scan_7days (global)",
      message: "scan_7days"
    },
    {
      name: "1ag. English keyword command: scan_7days with EmployeeID ('scan_7days KHH00108')",
      message: "scan_7days KHH00108"
    },
    {
      name: "1ah. Empty scans fallback test for range",
      message: "scan_3days 99999"
    },
    {
      name: "2. Historical scans command (Valid Date with today's date)",
      message: `สแกน วันที่ ${new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' })}`
    },
    {
      name: "2b. Typo 'แสกน', dot separator, no spaces, BE year ('แสกนวันที่ 04.06.2569')",
      message: `แสกนวันที่ 04.06.2569`
    },
    {
      name: "2c. Typo 'แสกน', dash separator, with spaces, AD year ('แสกน วันที่ 04-06-2026')",
      message: `แสกน วันที่ 04-06-2026`
    },
    {
      name: "2d. Correct spelling, slash separator, no spaces, AD year ('สแกนวันที่ 04/06/2026')",
      message: `สแกนวันที่ 04/06/2026`
    },
    {
      name: "3. Historical scans command (Valid Date but no data)",
      message: "สแกน วันที่ 01/01/2000"
    },
    {
      name: "4. Historical scans command (Invalid Date)",
      message: "สแกน วันที่ 31/02/2026"
    },
    {
      name: "5. Invalid date separator / format",
      message: "สแกน วันที่ 123456"
    },
    {
      name: "6. Non-command message (Should return null to fallback to LINE ID info)",
      message: "ขอไอดีหน่อยครับ"
    },
    {
      name: "6b. Lookup EmployeeID by platform ID (LINE_TOKEN found)",
      message: "ขอรหัสemployeeid",
      userId: "U05cc0548c832d582e2bf49966f0e1ad1"
    },
    {
      name: "6c. Lookup EmployeeID by platform ID (LINE_YOUR_USER_ID found)",
      message: "ขอรหัสemployeeid",
      userId: "U285bfba33061c6d1f435db9e55b09a91"
    },
    {
      name: "6d. Lookup EmployeeID by platform ID (Not found)",
      message: "ขอรหัสemployeeid",
      userId: "U_invalid_token"
    }
  ];

  for (const tc of testCases) {
    console.log(`----------------------------------------`);
    console.log(`Test case: ${tc.name}`);
    console.log(`Input message: "${tc.message}"`);
    try {
      const response = await ChatbotService.handleMessage(tc.message, tc.userId || 'test_user_id');
      console.log(`Output response:\n${response === null ? 'NULL (Fall back to LINE ID)' : response}`);
    } catch (err) {
      console.error(`❌ Error in test case:`, err);
    }
    console.log('');
  }

  console.log('----------------------------------------');
  console.log('🧪 Tests Completed.');
  process.exit(0);
}

runTests();
