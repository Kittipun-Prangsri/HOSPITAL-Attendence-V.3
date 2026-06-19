const { hosofficePool } = require('../config/db');

exports.getPersonnel = async (req, res) => {
  try {
    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    let query = `
      SELECT 
        p.ID, p.FINGLE_ID, p.HR_PREFIX_ID, p.HR_FNAME, p.HR_LNAME, p.NICKNAME, 
        p.HR_PHONE, p.HR_EMAIL, p.HR_DEPARTMENT_ID, d.HR_DEPARTMENT_NAME,
        p.HR_POSITION_ID, p.HR_STATUS_ID, s.HR_STATUS_NAME,
        p.HR_STARTWORK_DATE, p.HR_CID, p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id,
        p.WORK_SHIFT, p.TIME_IN, p.TIME_OUT
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON s.HR_STATUS_ID = p.HR_STATUS_ID
    `;
    let params = [];
    if (!isPrivileged) {
      query += ` WHERE p.ID = ?`;
      params.push(currentUser.id);
    }

    const [personnel] = await hosofficePool.query(query, params);
    res.json({ personnel });
  } catch (error) {
    console.error('Database query error (hosoffice):', error);
    res.status(500).json({ personnel: [] });
  }
};

exports.updateStaff = async (req, res) => {
  const { id, nickname, phone, email, line_user_id, telegram_chat_id, work_shift, time_in, time_out } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Missing staff ID' });

  const currentUser = req.session.user;
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

  try {
    // Security Check: If not admin/super, the 'id' (FINGLE_ID) must belong to the logged-in user
    if (!isPrivileged) {
      const [userRows] = await hosofficePool.query('SELECT FINGLE_ID FROM hr_person WHERE ID = ?', [currentUser.id]);
      const userFingleId = userRows.length > 0 ? userRows[0].FINGLE_ID : null;
      if (String(id) !== String(userFingleId)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์แก้ไขข้อมูลผู้อื่น' });
      }
    }

    const [result] = await hosofficePool.query(
      `UPDATE hr_person SET NICKNAME = ?, HR_PHONE = ?, HR_EMAIL = ?, LINE_YOUR_USER_ID = ?, TELEGRAM_CHAT_ID = ?, WORK_SHIFT = ?, TIME_IN = ?, TIME_OUT = ? WHERE FINGLE_ID = ?`,
      [nickname || null, phone || null, email || null, line_user_id || null, telegram_chat_id || null, work_shift || null, time_in || null, time_out || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Personnel not found.' });
    }
    res.json({ success: true, message: 'อัปเดตข้อมูลบุคลากรเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error updating personnel:', error);
    res.status(500).json({ success: false, message: 'Database update failed.' });
  }
};

exports.getPersonnelTemplate2 = async (req, res) => {
  try {
    const { yearMonth, template = '2' } = req.query; 
    const suffix = template === '2' ? '_8' : '';

    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    let query = `
      SELECT 
        hp.ID, hp.FINGLE_ID, hp.HR_FNAME, hp.HR_LNAME,
        COALESCE(htt.HILING_TIME_NAME, d.HR_DEPARTMENT_NAME) AS HR_DEPARTMENT_NAME,
        s.HR_STATUS_NAME AS role
      FROM hr_person hp
      LEFT JOIN hr_person_hiling_time hht ON hht.HR_PERSON_ID = hp.ID
      LEFT JOIN hiling_time_template htt ON htt.ID = hht.TEMPLATE_ID
      LEFT JOIN hr_department d ON hp.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON hp.HR_STATUS_ID = s.HR_STATUS_ID
      WHERE hht.TEMPLATE_ID = ?
    `;
    let params = [template];
    if (!isPrivileged) {
      query += ` AND hp.ID = ?`;
      params.push(currentUser.id);
    }
    
    const [personnel] = await hosofficePool.query(query, params);

    let scans = { morning: [], afternoon: [], night: [] };
    if (yearMonth) {
      try {
        let morningQuery = `SELECT * FROM service_work_scans${suffix}_morning WHERE year_and_month = ?`;
        let afternoonQuery = `SELECT * FROM service_work_scans${suffix}_afternoon WHERE year_and_month = ?`;
        let nightQuery = `SELECT * FROM service_work_scans${suffix}_night WHERE year_and_month = ?`;
        let scanParams = [yearMonth];

        if (!isPrivileged) {
          morningQuery += ` AND hr_person_id = ?`;
          afternoonQuery += ` AND hr_person_id = ?`;
          nightQuery += ` AND hr_person_id = ?`;
          scanParams.push(currentUser.id);
        }

        const [morning] = await hosofficePool.query(morningQuery, scanParams);
        const [afternoon] = await hosofficePool.query(afternoonQuery, scanParams);
        const [night] = await hosofficePool.query(nightQuery, scanParams);
        scans = { morning, afternoon, night };
      } catch (err) {
        console.warn('Error fetching scans tables:', err.message);
      }
    }
    res.json({ personnel, scans });
  } catch (error) {
    console.error('Database query error (personnel-monthly):', error);
    res.status(500).json({ personnel: [], scans: { morning: [], afternoon: [], night: [] } });
  }
};

exports.getPersonByFingleId = async (req, res) => {
  try {
    const { fingleId } = req.params;
    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');
    const isOwner = currentUser && (String(fingleId) === String(currentUser.username));

    const [rows] = await hosofficePool.query(`
      SELECT
        p.ID, p.FINGLE_ID, p.HR_PREFIX_ID,
        p.HR_FNAME, p.HR_LNAME, p.NICKNAME,
        p.HR_PHONE, p.HR_EMAIL,
        d.HR_DEPARTMENT_NAME,
        s.HR_STATUS_NAME,
        p.HR_STARTWORK_DATE,
        p.HR_CID,
        p.LINE_YOUR_USER_ID as line_user_id,
        p.TELEGRAM_CHAT_ID as telegram_chat_id
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s     ON s.HR_STATUS_ID = p.HR_STATUS_ID
      WHERE p.FINGLE_ID = ?
      LIMIT 1
    `, [fingleId]);

    if (rows.length === 0) return res.status(404).json({ person: null, message: 'Not found' });
    
    const person = rows[0];
    
    // Security check moved to after query to allow owners to see their own data
    if (!isPrivileged && !isOwner) {
        return res.status(403).json({ success: false, error: 'เข้าถึงไม่ได้: สิทธิ์การเข้าถึงข้อมูลเฉพาะของตนเองเท่านั้น' });
    }

    res.json({ person });
  } catch (error) {
    console.error('GET /api/personnel/:fingleId error:', error);
    res.status(500).json({ person: null });
  }
};

exports.getAttendanceHistory = async (req, res) => {
  try {
    const { fingleId } = req.params;
    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    if (!isPrivileged) {
      // Find the user's FINGLE_ID
      const [userRows] = await hosofficePool.query('SELECT FINGLE_ID FROM hr_person WHERE ID = ?', [currentUser.id]);
      const userFingleId = userRows.length > 0 ? userRows[0].FINGLE_ID : null;
      if (String(fingleId) !== String(userFingleId)) {
        return res.status(403).json({ success: false, error: 'เข้าถึงไม่ได้: สิทธิ์การเข้าถึงข้อมูลเฉพาะของตนเองเท่านั้น' });
      }
    }

    const workStart = req.query.workStart || '08:00';
    const today = new Date();
    const history = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      let check_in  = '-';
      let check_out = '-';
      let status    = 'absent';

      try {
        const [rows] = await hosofficePool.query(`
          SELECT
            LEFT(MIN(AccessTime), 5) AS time_in,
            LEFT(MAX(AccessTime), 5) AS time_out
          FROM hikvision
          WHERE EmployeeID = ? AND AccessDate = ?
        `, [fingleId, dateStr]);

        if (rows.length > 0 && rows[0].time_in) {
          check_in  = rows[0].time_in;
          check_out = rows[0].time_out || '-';
          const [lh, lm] = workStart.split(':').map(Number);
          const [ih, im] = check_in.split(':').map(Number);
          const lateBy   = (ih * 60 + im) - (lh * 60 + lm);
          status = lateBy > 5 ? 'late' : 'normal';
        }

        try {
          const day = d.getDate();
          const ym  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const [pRows] = await hosofficePool.query(`SELECT p.ID FROM hr_person p WHERE p.FINGLE_ID = ? LIMIT 1`, [fingleId]);
          if (pRows.length > 0) {
            const [swRows] = await hosofficePool.query(
              `SELECT \`di${day}\` AS dayval FROM service_work_scans_morning
               WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1`,
              [pRows[0].ID, ym]
            );
            if (swRows.length > 0 && swRows[0].dayval && !/^\d{2}:\d{2}/.test(swRows[0].dayval)) {
              status    = 'leave';
              check_in  = '-';
              check_out = '-';
            }
          }
        } catch {}
      } catch {}
      history.push({ date: dateStr, check_in, check_out, status });
    }
    res.json({ success: true, staff_id: fingleId, history });
  } catch (err) {
    console.error('GET /api/attendance/history error:', err);
    res.status(500).json({ history: [] });
  }
};
