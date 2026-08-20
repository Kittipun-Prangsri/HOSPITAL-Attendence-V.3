require('dotenv').config();
const { hosofficePool, pool } = require('../src/config/db');

async function retestLatestScan() {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

    // 1. Find the latest scan record
    const [scans] = await hosofficePool.query(`
      SELECT EmployeeID, AccessDate, AccessTime, PersonName, DeviceName
      FROM hikvision
      ORDER BY AccessDate DESC, AccessTime DESC
      LIMIT 1
    `);

    if (scans.length === 0) {
      console.log('❌ ไม่พบรายการสแกนในตาราง hikvision');
      process.exit(1);
    }

    const latest = scans[0];
    console.log(`📌 พบรายการสแกนล่าสุด:`);
    console.log(`   👤 บุคลากร: ${latest.PersonName} (${latest.EmployeeID})`);
    console.log(`   📅 วันที่: ${latest.AccessDate} | ⏰ เวลา: ${latest.AccessTime}`);
    console.log(`   🚪 เครื่องสแกน: ${latest.DeviceName}`);

    // 2. Clear old delivery record in notification_deliveries if exists
    await pool.query(`
      DELETE FROM notification_deliveries 
      WHERE employee_id = ? AND access_date = ? AND access_time = ?
    `, [latest.EmployeeID, latest.AccessDate, latest.AccessTime]);

    // 3. Reset is_notified = 1 in hikvision
    await hosofficePool.query(`
      UPDATE hikvision 
      SET is_notified = 1 
      WHERE EmployeeID = ? AND AccessDate = ? AND AccessTime = ?
    `, [latest.EmployeeID, latest.AccessDate, latest.AccessTime]);

    console.log(`\n✅ ปรับค่า is_notified = 1 สำเร็จแล้ว!`);
    console.log(`🚀 RealtimeNotifier (PM2) จะตรวจพบและส่ง LINE Flex Message ดีไซน์ใหม่ภายใน 5 วินาที...`);
    process.exit(0);

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการรีเทส:', err);
    process.exit(1);
  }
}

retestLatestScan();
