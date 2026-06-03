const fs = require('fs');
const path = require('path');
const { pool, hosofficePool } = require('../config/db');
const NotificationService = require('../services/notificationService');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const MONTHLY_SCHEDULE_DIR = path.join(DATA_DIR, 'monthly_schedules');

// Helper to determine the scheduled shift for a given employee and date
function getScheduledShift(empId, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const monthFile = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
  
  if (fs.existsSync(monthFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
      const empSched = (data.schedule || {})[empId] || {};
      const shift = empSched[String(day)];
      if (shift && shift !== 'OFF' && shift !== 'EMPTY') {
        return shift;
      }
    } catch (e) {
      console.error('Error reading monthly schedule:', e);
    }
  }
  
  // Fallback to weekly schedule
  if (fs.existsSync(SCHEDULE_FILE)) {
    try {
      const weekly = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      const match = weekly.find(s => s.emp_id === String(empId) && s.date === dateStr);
      if (match && match.shift && match.shift !== 'EMPTY' && match.shift !== 'OFF') {
        return match.shift;
      }
    } catch (e) {
      console.error('Error reading weekly schedule:', e);
    }
  }
  
  return null;
}

// Format past date helper
function getPastDateString(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/**
 * Fetch excuses. Admins/managers see all; users see only theirs.
 */
exports.getExcuses = async (req, res) => {
  const user = req.session.user;
  try {
    let query = 'SELECT id, username, fullname, date, issue_type, reason, status, admin_comment, submitted_at, reviewed_at FROM attendance_excuses';
    let params = [];
    
    if (user.role !== 'admin' && user.role !== 'super') {
      query += ' WHERE username = ?';
      params.push(user.username);
    }
    
    query += ' ORDER BY date DESC, submitted_at DESC';
    
    const [rows] = await pool.query(query, params);
    res.json({ success: true, excuses: rows });
  } catch (error) {
    console.error('Error getting excuses:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลเหตุผลได้' });
  }
};

/**
 * Create or update an excuse
 */
exports.createExcuse = async (req, res) => {
  const user = req.session.user;
  const { date, issue_type, reason } = req.body;
  
  if (!date || !issue_type || !reason) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }
  
  try {
    // Insert and update on duplicate (resubmission)
    await pool.query(`
      INSERT INTO attendance_excuses (username, fullname, date, issue_type, reason, status) 
      VALUES (?, ?, ?, ?, ?, 'pending')
      ON DUPLICATE KEY UPDATE issue_type = VALUES(issue_type), reason = VALUES(reason), status = 'pending', admin_comment = NULL, reviewed_at = NULL
    `, [user.username, user.fullname, date, issue_type, reason]);
    
    // Notify LINE Admin
    if (process.env.LINE_ADMIN_USER_ID) {
      let thaiIssue = 'แสกนไม่ติด';
      if (issue_type === 'absent') thaiIssue = 'ขาดงาน';
      if (issue_type === 'leave') thaiIssue = 'ลา';
      if (issue_type === 'late') thaiIssue = 'มาสาย';
      
      const adminMsg = `🔔 *มีรายการส่งใบแก้ต่างใหม่*\n\n` +
                        `👤 บุคลากร: ${user.fullname}\n` +
                        `📅 ประจำวันที่: ${new Date(date).toLocaleDateString('th-TH')}\n` +
                        `📍 ประเภทปัญหา: ${thaiIssue}\n` +
                        `💬 เหตุผล: ${reason}`;
      await NotificationService.sendDirectLine(process.env.LINE_ADMIN_USER_ID, adminMsg);
    }
    
    res.json({ success: true, message: 'บันทึกข้อมูลและส่งเรื่องแก้ต่างเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error creating excuse:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
};

/**
 * Approve or Reject an excuse (Admin only)
 */
exports.reviewExcuse = async (req, res) => {
  const { id, status, admin_comment } = req.body;
  
  if (!id || !status) {
    return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบถ้วนสำหรับการอนุมัติ' });
  }
  
  try {
    // 1. Update the database
    await pool.query(
      'UPDATE attendance_excuses SET status = ?, admin_comment = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, admin_comment || null, id]
    );
    
    // 2. Query the excuse to send a notification to the user
    const [rows] = await pool.query('SELECT username, date, issue_type FROM attendance_excuses WHERE id = ?', [id]);
    if (rows.length > 0) {
      const excuse = rows[0];
      const [userRows] = await hosofficePool.query('SELECT LINE_YOUR_USER_ID as line_user_id, CONCAT(HR_FNAME, "   ", HR_LNAME) as fullname FROM hr_person WHERE HR_CID = ?', [excuse.username]);
      if (userRows.length > 0 && userRows[0].line_user_id) {
        const lineUserId = userRows[0].line_user_id;
        
        let thaiIssue = 'แสกนไม่ติด';
        if (excuse.issue_type === 'absent') thaiIssue = 'ขาดงาน';
        if (excuse.issue_type === 'leave') thaiIssue = 'ลา';
        if (excuse.issue_type === 'late') thaiIssue = 'มาสาย';

        const reviewMsg = `🔔 *ผลการพิจารณาใบแก้ต่าง*\n\n` +
                          `👤 สวัสดีคุณ: ${userRows[0].fullname}\n` +
                          `📅 ประจำวันที่: ${new Date(excuse.date).toLocaleDateString('th-TH')} (${thaiIssue})\n` +
                          `📍 ผลการตรวจ: ${status === 'approved' ? '✅ อนุมัติการแก้ต่าง' : '❌ ปฏิเสธ/ไม่อนุมัติ'}\n` +
                          `💬 ความเห็นผู้ตรวจสอบ: ${admin_comment || 'ไม่มี'}`;
        await NotificationService.sendDirectLine(lineUserId, reviewMsg);
      }
    }
    
    res.json({ success: true, message: 'บันทึกผลการพิจารณาเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error reviewing excuse:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
};

/**
 * Scan last 7 days of schedules and find users with exceptions who have NOT submitted approved excuses.
 */
exports.getRemindersList = async (req, res) => {
  try {
    const list = await exports.compileReminderCandidates();
    res.json({ success: true, reminders: list });
  } catch (error) {
    console.error('Error getting reminders list:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลพนักงานค้างส่งได้' });
  }
};

/**
 * Send reminders manually or via cron
 */
exports.sendReminders = async (req, res) => {
  const { candidates } = req.body;
  if (!candidates || !Array.isArray(candidates)) {
    return res.status(400).json({ success: false, error: 'ข้อมูลผู้รับไม่ถูกต้อง' });
  }
  
  let successCount = 0;
  let failCount = 0;
  
  try {
    for (const c of candidates) {
      // Find line ID of candidate
      const [userRows] = await hosofficePool.query('SELECT LINE_YOUR_USER_ID as line_user_id FROM hr_person WHERE HR_CID = ?', [c.username]);
      if (userRows.length > 0 && userRows[0].line_user_id) {
        const lineUserId = userRows[0].line_user_id;
        const thaiIssue = c.issue_type === 'late' ? 'มาสาย' : 'ขาดงาน / ไม่แสกนเข้างาน';
        const msg = `⚠️ *แจ้งเตือน: ค้างส่งใบแก้ต่างการลงเวลา*\n\n` +
                    `👤 สวัสดีคุณ: ${c.fullname}\n` +
                    `📅 วันที่พบปัญหา: ${new Date(c.date).toLocaleDateString('th-TH')}\n` +
                    `📍 สถานะการแสกน: ${thaiIssue} (${c.elapsed_days} วันที่ผ่านมา)\n\n` +
                    `👉 กรุณาเข้าสู่ระบบไปที่เมนู "แจ้งสาเหตุ / ขาด ลา สาย" เพื่อส่งใบแก้ต่างภายในกำหนดด้วยครับ`;
        const success = await NotificationService.sendDirectLine(lineUserId, msg);
        if (success) successCount++;
        else failCount++;
      } else {
        failCount++;
      }
    }
    
    res.json({ success: true, message: `ส่งแจ้งเตือนสำเร็จ ${successCount} รายการ, ล้มเหลว ${failCount} รายการ` });
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการส่งข้อความแจ้งเตือน' });
  }
};

/**
 * Compile all candidates with exceptions in last 7 days who have not sent approved excuses
 */
exports.compileReminderCandidates = async () => {
  const startStr = getPastDateString(7);
  const endStr = getPastDateString(1);
  const lateMin = 31;
  const workStart = '08:00';
  const [h, m] = workStart.split(':').map(Number);
  const lateTotalMinutes = h * 60 + m + lateMin;
  const lateH = Math.floor(lateTotalMinutes / 60).toString().padStart(2, '0');
  const lateM = (lateTotalMinutes % 60).toString().padStart(2, '0');
  const lateThresholdTime = `${lateH}:${lateM}:00`;

  // 1. Get all local users who are registered
  const [users] = await hosofficePool.query('SELECT HR_CID as username, CONCAT(HR_FNAME, "   ", HR_LNAME) as fullname, LINE_YOUR_USER_ID as line_user_id FROM hr_person WHERE USER_TYPE IS NOT NULL AND HR_CID IS NOT NULL');
  
  if (users.length === 0) return [];
  
  // 2. Fetch all excuses submitted for this range
  const [excuses] = await pool.query(
    'SELECT username, date, status FROM attendance_excuses WHERE date BETWEEN ? AND ?',
    [startStr, endStr]
  );
  const excusesMap = {};
  excuses.forEach(ex => {
    const key = `${ex.username}_${ex.date.toISOString().split('T')[0]}`;
    excusesMap[key] = ex.status;
  });

  // 3. Fetch Hikvision scans in bulk for the last 7 days
  const [scans] = await hosofficePool.query(
    'SELECT EmployeeID, AccessDate, MIN(AccessTime) as time_in FROM hikvision WHERE AccessDate BETWEEN ? AND ? GROUP BY EmployeeID, AccessDate',
    [startStr, endStr]
  );
  const scansMap = {};
  scans.forEach(s => {
    scansMap[`${s.EmployeeID}_${s.AccessDate}`] = s.time_in;
  });

  const remindersList = [];
  const todayObj = new Date();
  
  // 4. Evaluate each user for each day in past 7 days
  for (let i = 7; i >= 1; i--) {
    const targetDateStr = getPastDateString(i);
    const targetDateObj = new Date(targetDateStr);
    const elapsedDays = Math.floor((todayObj - targetDateObj) / (24 * 60 * 60 * 1000));
    
    users.forEach(user => {
      const shift = getScheduledShift(user.username, targetDateStr);
      if (shift) {
        // Person is scheduled to work! Let's check their scan
        const key = `${user.username}_${targetDateStr}`;
        const scanTime = scansMap[key];
        
        let exceptionType = null;
        if (!scanTime) {
          exceptionType = 'absent'; // No scan found (absent)
        } else if (scanTime > lateThresholdTime) {
          exceptionType = 'late'; // Scanned but late
        }
        
        if (exceptionType) {
          // Check if they have an approved excuse
          const excuseStatus = excusesMap[key];
          if (excuseStatus !== 'approved') {
            remindersList.push({
              username: user.username,
              fullname: user.fullname,
              date: targetDateStr,
              issue_type: exceptionType,
              elapsed_days: elapsedDays,
              has_line: !!user.line_user_id,
              excuse_status: excuseStatus || 'none'
            });
          }
        }
      }
    });
  }
  
  return remindersList;
};
