const { hosofficePool } = require('../../src/config/db');

async function testRealtimeScanNotification() {
  const employeeId = 'KHH00108'; // กิตติพันธ์ ปรางศรี
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
  
  console.log(`[Test] Simulating scan at ${time} for today ${today}...`);
  
  try {
    // 1. Insert dummy scan with is_notified = 0
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
        PersonGroup, 
        Direction, 
        SkinSurfaceTemperature, 
        is_notified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      employeeId,
      `${today}T${time}`,
      today,
      time,
      'Success',
      'ACSEventFaceVerifyPass',
      'TestDevice_Antigravity',
      'กิตติพันธ์ ปรางศรี',
      'กลุ่มงานการแพทย์',
      'in',
      '36.5',
      0
    ]);
    
    console.log('[Test] Simulated scan inserted successfully. Waiting 7 seconds for realtimeNotifier to process...');
    
    await new Promise(resolve => setTimeout(resolve, 7000));
    
    // 2. Query to verify if is_notified is updated to 1
    const [rows] = await hosofficePool.query(`
      SELECT is_notified, AccessDate, AccessTime 
      FROM hikvision 
      WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?
    `, [employeeId, today, time]);
    
    if (rows.length > 0) {
      const scan = rows[0];
      console.log(`[Test] Result from db: is_notified = ${scan.is_notified}`);
      if (scan.is_notified === 1 || scan.is_notified === 2 || scan.is_notified === 3) {
        console.log('🎉 SUCCESS! The realtimeNotifier or the system database trigger picked up the scan, sent the LINE notification, and marked it as notified.');
      } else {
        console.log('❌ FAILED: The scan was not marked as notified.');
      }
    } else {
      console.log('❌ FAILED: Simulated scan record not found in db.');
    }
  } catch (err) {
    console.error('[Test] Error:', err);
  } finally {
    process.exit();
  }
}

testRealtimeScanNotification();
