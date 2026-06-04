const bcrypt = require('bcryptjs');
const { pool, hosofficePool } = require('../config/db');

const NotificationService = require('../services/notificationService');

exports.getUsers = async (req, res) => {
  try {
    const [rows] = await hosofficePool.query(
      `SELECT 
        p.ID as id, 
        p.HR_CID as username, 
        CONCAT(p.HR_FNAME, " ", p.HR_LNAME) as fullname, 
        p.USER_TYPE as role, 
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        d.HR_DEPARTMENT_NAME as dept
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE p.USER_TYPE IS NOT NULL AND p.HR_CID IS NOT NULL`
    );
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
  try {
    let dbRole = 'USER';
    if (role === 'super') dbRole = 'SUPER';
    else if (role === 'admin' || role === 'manager' || role === 'staff') dbRole = 'ADMIN';

    // Check if this record already exists in hr_person (by HR_CID / username)
    const [existing] = await hosofficePool.query('SELECT ID FROM hr_person WHERE HR_CID = ?', [username]);

    if (existing.length > 0) {
      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        await hosofficePool.query(
          'UPDATE hr_person SET USER_TYPE = ?, HR_PASSWORD_HASH = ?, LINE_YOUR_USER_ID = ?, TELEGRAM_CHAT_ID = ? WHERE HR_CID = ?',
          [dbRole, hashed, line_user_id || null, telegram_chat_id || null, username]
        );
      } else {
        await hosofficePool.query(
          'UPDATE hr_person SET USER_TYPE = ?, LINE_YOUR_USER_ID = ?, TELEGRAM_CHAT_ID = ? WHERE HR_CID = ?',
          [dbRole, line_user_id || null, telegram_chat_id || null, username]
        );
      }
      res.json({ success: true, message: 'User updated successfully' });
    } else {
      const hashed = await bcrypt.hash(password || 'staff1234', 10);
      const nameParts = (fullname || '').split(' ');
      const fname = nameParts[0] || 'New';
      const lname = nameParts.slice(1).join(' ') || 'User';

      await hosofficePool.query(
        'INSERT INTO hr_person (HR_CID, HR_FNAME, HR_LNAME, USER_TYPE, HR_PASSWORD_HASH, LINE_YOUR_USER_ID, TELEGRAM_CHAT_ID) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, fname, lname, dbRole, hashed, line_user_id || null, telegram_chat_id || null]
      );
      res.json({ success: true, message: 'User created successfully' });
    }
  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to save user' });
  }
};

exports.testLine = async (req, res) => {
  const { userId } = req.body;
  try {
    const [rows] = await hosofficePool.query(
      'SELECT LINE_YOUR_USER_ID as line_user_id, CONCAT(HR_FNAME, " ", HR_LNAME) as fullname FROM hr_person WHERE ID = ?',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    const user = rows[0];
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

exports.testTelegram = async (req, res) => {
  const { userId } = req.body;
  try {
    const [rows] = await hosofficePool.query(
      'SELECT TELEGRAM_CHAT_ID as telegram_chat_id, CONCAT(HR_FNAME, " ", HR_LNAME) as fullname FROM hr_person WHERE ID = ?',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    const user = rows[0];
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
    await hosofficePool.query(
      'UPDATE hr_person SET USER_TYPE = NULL, HR_PASSWORD_HASH = NULL WHERE ID = ?',
      [id]
    );
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

exports.resetPassword = async (req, res) => {
  const { id } = req.params;
  try {
    const defaultPassword = '1234';
    const hashed = await bcrypt.hash(defaultPassword, 10);
    const [result] = await hosofficePool.query(
      'UPDATE hr_person SET HR_PASSWORD_HASH = ? WHERE ID = ?',
      [hashed, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }
    res.json({ success: true, message: 'รีเซ็ตรหัสผ่านเป็น 1234 สำเร็จแล้ว' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน' });
  }
};
