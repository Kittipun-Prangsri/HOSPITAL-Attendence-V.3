const bcrypt = require('bcryptjs');
const { hosofficePool } = require('../config/db');

exports.getLogin = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
  const { username, password } = req.body;
  console.log(`[Auth] Login attempt for username: ${username}`);
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 50 || password.length > 200) {
    return res.status(400).render('login', { error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }
  try {
    const [rows] = await hosofficePool.query(
      'SELECT ID as id, HR_CID as cid, FINGLE_ID as fingle_id, CONCAT(HR_FNAME, \' \', HR_LNAME) as fullname, USER_TYPE as role, HR_PASSWORD_HASH as password_hash FROM hr_person WHERE HR_CID = ? OR FINGLE_ID = ?',
      [username, username]
    );

    if (rows.length > 0) {
      const user = rows[0];
      const roleLower = user.role ? user.role.toLowerCase() : 'user';

      const isMatch = Boolean(user.password_hash) && await bcrypt.compare(password, user.password_hash);

      if (isMatch) {
        console.log(`[Auth] Login successful for ${username} (${user.fullname})`);
        req.session.user = { 
          id: user.id, 
          username: user.fingle_id || user.cid, 
          fullname: user.fullname, 
          role: roleLower
        };
        
        return req.session.save((err) => {
          if (err) {
            console.error('[Auth] Session save error:', err);
            return res.render('login', { error: 'เกิดข้อผิดพลาดในการบันทึกเซสชัน' });
          }
          res.redirect('/');
        });
      } else {
        console.log(`[Auth] Password mismatch for ${username}`);
      }
    } else {
      console.log(`[Auth] User not found: ${username}`);
    }
    res.render('login', { error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.render('login', { error: 'เกิดข้อผิดพลาดของระบบ' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect('/login');
};
