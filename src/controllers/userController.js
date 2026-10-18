const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/audit');
const crypto = require('crypto');
const { pool, hosofficePool, STAFF } = require('../config/db');

const NotificationService = require('../services/notificationService');
const { attachLinks, applyLinkInput, linkOf } = require('../services/messagingLinks');
const { saveAccount, closeAccount } = require('../services/staffStore');

exports.getUsers = async (req, res) => {
  try {
    const [rows] = await hosofficePool.query(
      `SELECT 
        p.ID as id, 
        p.HR_CID as username, 
        CONCAT(p.HR_FNAME, " ", p.HR_LNAME) as fullname, 
        p.USER_TYPE as role, 
        d.HR_DEPARTMENT_NAME as dept
      FROM ${STAFF} p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE p.USER_TYPE IS NOT NULL AND p.HR_CID IS NOT NULL`
    );
    await attachLinks(rows, 'id');
    const mappedRows = rows.map(r => ({
      ...r,
      role: r.role ? r.role.toLowerCase() : 'user'
    }));
    res.json({ users: mappedRows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

exports.saveUser = async (req, res) => {
  const { id, username, password, fullname, role, line_user_id, telegram_chat_id } = req.body;
  if (typeof username !== 'string' || username.trim().length === 0 || username.length > 50 || typeof fullname !== 'string' || fullname.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username or full name' });
  }
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8 || password.length > 200)) {
    return res.status(400).json({ error: 'Password must be 8-200 characters long' });
  }
  try {
    let dbRole = 'USER';
    if (role === 'super') dbRole = 'SUPER';
    else if (role === 'admin' || role === 'manager' || role === 'staff') dbRole = 'ADMIN';

    // Accounts are only for people HR has entered in HOSoffice (by HR_CID / username)
    const [existing] = await hosofficePool.query(`SELECT ID, HR_PASSWORD_HASH AS hash FROM ${STAFF} WHERE HR_CID = ?`, [username]);

    const saveLinks = async personId => {
      for (const [channel, value] of [['line', line_user_id], ['telegram', telegram_chat_id]]) {
        await applyLinkInput({ personId, channel, value: value === undefined ? undefined : value || '', via: 'admin', by: req.session.user.fullname });
      }
    };

    if (existing.length === 0) {
      return res.status(404).json({ error: 'ไม่พบเลขบัตรประชาชนนี้ในทะเบียนบุคลากร HOSoffice — ให้งานบุคคลเพิ่มบุคลากรใน HOSoffice ก่อน แล้วจึงสร้างบัญชี' });
    }
    if (!password && !existing[0].hash) {
      return res.status(400).json({ error: 'A password of at least 8 characters is required for new users' });
    }
    const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
    await saveAccount(existing[0].ID, { role: dbRole, passwordHash }, req.session.user.fullname);
    await saveLinks(existing[0].ID);
    logAudit(req, id ? 'update' : 'create', 'user', username, { fullname, role, passwordChanged: Boolean(password) });
    res.json({ success: true, message: 'User saved successfully' });
  } catch (error) {
    if (error.code === 'TAKEN' || error.code === 'FORMAT') return res.status(error.code === 'TAKEN' ? 409 : 400).json({ error: error.message });
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to save user' });
  }
};

exports.testLine = async (req, res) => {
  const { userId } = req.body;
  try {
    const [rows] = await hosofficePool.query(
      `SELECT CONCAT(HR_FNAME, " ", HR_LNAME) as fullname FROM ${STAFF} WHERE ID = ?`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    const user = { ...rows[0], line_user_id: (await linkOf(userId)).line };
    if (!user.line_user_id) {
      return res.status(400).json({ success: false, error: 'ผู้ใช้งานนี้ยังไม่ได้ระบุ LINE ID' });
    }

    const testMessage = `🔔 *ทดสอบการแจ้งเตือน LINE*\n\n` +
                        `สวัสดีคุณ ${user.fullname}\n` +
                        `นี่คือข้อความทดสอบจากระบบบันทึกเวลาปฏิบัติงาน KHH Attendance`;

    const success = await NotificationService.sendDirectLine(user.line_user_id, testMessage);
    if (success) {
      res.json({ success: true, message: 'ส่งข้อความทดสอบไปยัง LINE สำเร็จแล้ว' });
    } else {
      res.status(500).json({ success: false, error: 'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบว่าผู้ใช้งานแอดไลน์บอทแล้วหรือยัง' });
    }
  } catch (error) {
    console.error('Error testing LINE:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
};

exports.testLineFlex = async (req, res) => {
  const flexBuilder = require('../services/flexBuilder');
  const { lineUserId, statusType = 'check-in', fullname, employeeId, deviceName } = req.body;
  try {
    const targetUserId = lineUserId || process.env.LINE_ADMIN_USER_ID;
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ LINE User ID หรือตั้งค่า LINE_ADMIN_USER_ID ใน .env' });
    }

    const now = new Date();
    const dateThai = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    let direction = 'in';
    let attendanceStatus = 'i';
    let isLate = false;
    let authResult = 'Success';

    if (statusType === 'check-out' || statusType === 'out') {
      direction = 'out';
      attendanceStatus = 'o';
    } else if (statusType === 'late') {
      direction = 'in';
      attendanceStatus = 'i';
      isLate = true;
    } else if (statusType === 'failed') {
      authResult = 'Failed';
    }

    const flexPayload = flexBuilder.buildAttendanceFlex({
      fullname: fullname || 'คุณกิตติพันธ์ ปรางศรี (ทดสอบ)',
      employeeId: employeeId || 'KHH-8921',
      direction,
      attendanceStatus,
      authResult,
      dateThai,
      timeStr,
      deviceName: deviceName || 'KHHin2 (ประตูหน้าหลัก)',
      temperature: '36.5',
      isLate
    });

    const result = await NotificationService.sendDirectNotification(
      targetUserId,
      null,
      `🔔 *ทดสอบ LINE Flex Message*\n\nสวัสดีคุณ ${fullname || 'ผู้ใช้งาน'}`,
      {},
      flexPayload
    );

    if (result.line) {
      res.json({ success: true, message: 'ส่ง LINE Flex Message สำเร็จแล้ว!' });
    } else {
      res.status(500).json({ success: false, error: 'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบว่า LINE Access Token และ User ID ถูกต้อง' });
    }
  } catch (error) {
    console.error('Error in testLineFlex:', error);
    res.status(500).json({ success: false, error: error.message || 'เกิดข้อผิดพลาดภายในระบบ' });
  }
};

exports.testTelegram = async (req, res) => {
  const { userId } = req.body;
  try {
    const [rows] = await hosofficePool.query(
      `SELECT CONCAT(HR_FNAME, " ", HR_LNAME) as fullname FROM ${STAFF} WHERE ID = ?`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    const user = { ...rows[0], telegram_chat_id: (await linkOf(userId)).telegram };
    if (!user.telegram_chat_id) {
      return res.status(400).json({ success: false, error: 'ผู้ใช้งานนี้ยังไม่ได้ระบุ Telegram Chat ID' });
    }

    const testMessage = `🔔 *ทดสอบการแจ้งเตือน Telegram*\n\n` +
                        `สวัสดีคุณ ${user.fullname}\n` +
                        `นี่คือข้อความทดสอบจากระบบบันทึกเวลาปฏิบัติงาน KHH Attendance`;

    const success = await NotificationService.sendDirectTelegram(user.telegram_chat_id, testMessage);
    if (success) {
      res.json({ success: true, message: 'ส่งข้อความทดสอบไปยัง Telegram สำเร็จแล้ว' });
    } else {
      res.status(500).json({ success: false, error: 'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบว่าบอทได้ถูกเปิดใช้งานและโทเคนถูกต้องหรือไม่' });
    }
  } catch (error) {
    console.error('Error testing Telegram:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await closeAccount(id, req.session.user.fullname);
    logAudit(req, 'delete', 'user', id);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

exports.resetPassword = async (req, res) => {
  const { id } = req.params;
  try {
    const temporaryPassword = crypto.randomBytes(12).toString('base64url');
    const hashed = await bcrypt.hash(temporaryPassword, 12);
    const [found] = await hosofficePool.query(`SELECT ID FROM ${STAFF} WHERE ID = ?`, [id]);
    if (found.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    await saveAccount(id, { passwordHash: hashed }, req.session.user.fullname);
    logAudit(req, 'reset_password', 'user', id);
    res.json({
      success: true,
      message: 'รีเซ็ตรหัสผ่านสำเร็จ กรุณาบันทึกรหัสชั่วคราวและส่งให้ผู้ใช้ผ่านช่องทางที่ปลอดภัย',
      temporaryPassword
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน' });
  }
};
