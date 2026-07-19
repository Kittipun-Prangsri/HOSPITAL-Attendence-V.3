const fs = require('fs');
const path = require('path');
const { hosofficePool } = require('../config/db');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const MONTHLY_SCHEDULE_DIR = path.join(DATA_DIR, 'monthly_schedules');

exports.getSchedule = (req, res) => {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Error reading schedule.json', err);
    res.status(500).json([]);
  }
};

exports.postSchedule = (req, res) => {
  try {
    const { emp_id, shift, date } = req.body;
    let schedule = [];
    if (fs.existsSync(SCHEDULE_FILE)) {
      schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
    }
    schedule = schedule.filter(s => !(s.emp_id === emp_id && s.date === date));
    if (shift && shift !== 'EMPTY') {
      schedule.push({ emp_id, shift, date });
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    console.error('Error writing schedule.json', err);
    res.status(500).json({ error: 'Failed to write' });
  }
};

exports.saveMonthlySchedule = (req, res) => {
  try {
    const { year, month, schedule } = req.body;
    if (!year || !month || !schedule) return res.status(400).json({ error: 'Missing year, month or schedule payload' });
    if (!fs.existsSync(MONTHLY_SCHEDULE_DIR)) fs.mkdirSync(MONTHLY_SCHEDULE_DIR, { recursive: true });
    const filename = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    const payload  = { year, month, savedAt: new Date().toISOString(), schedule };
    fs.writeFileSync(filename, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, file: filename });
  } catch (err) {
    console.error('Error saving monthly schedule:', err);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
};

exports.loadMonthlySchedule = (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'Missing year/month' });
    const filename = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    if (fs.existsSync(filename)) {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      res.json({ success: true, data });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to load schedule' });
  }
};

exports.getStaffSchedule = async (req, res) => {
  try {
    const { id, yearMonth } = req.params;
    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    if (!isPrivileged) {
      // Find the user's FINGLE_ID
      const [userRows] = await hosofficePool.query('SELECT FINGLE_ID FROM hr_person WHERE ID = ?', [currentUser.id]);
      const userFingleId = userRows.length > 0 ? userRows[0].FINGLE_ID : null;
      if (String(id) !== String(userFingleId)) {
        return res.status(403).json({ error: 'Forbidden: You can only access your own schedule' });
      }
    }

    const [year, month] = yearMonth.split('-').map(Number);
    if (!year || !month) return res.status(400).json({ error: 'Invalid yearMonth' });

    const targetMonth = yearMonth;
    const daysInMonth = new Date(year, month, 0).getDate();

    const shifts = [];
    const schedFile = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    if (fs.existsSync(schedFile)) {
      const savedSched = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
      const empSched   = (savedSched.schedule || {})[id] || {};
      Object.entries(empSched).forEach(([day, shift]) => {
        if (shift && shift !== 'OFF') shifts.push({ day: parseInt(day), shift });
      });
    } else {
      if (fs.existsSync(SCHEDULE_FILE)) {
        const old = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        old.filter(s => s.emp_id === id && s.date && s.date.startsWith(targetMonth))
           .forEach(s => {
             const day = parseInt(s.date.split('-')[2]);
             shifts.push({ day, shift: s.shift });
           });
      }
    }

    let times = [];
    try {
      const [rows] = await hosofficePool.query(`
        SELECT DAY(AccessDate) AS day, MIN(AccessTime) AS time_in, MAX(AccessTime) AS time_out
        FROM hikvision WHERE EmployeeID = ? AND AccessDate LIKE ?
        GROUP BY DAY(AccessDate) ORDER BY day
      `, [id, `${targetMonth}-%`]);
      times = rows.map(r => ({ day: r.day, time_in: r.time_in, time_out: r.time_out }));
    } catch (dbErr) {
      console.warn('[schedule/staff] hikvision query failed:', dbErr.message);
    }

    let leaves = [];
    try {
      const [personRows] = await hosofficePool.query(`SELECT p.ID FROM hr_person p WHERE p.FINGLE_ID = ? LIMIT 1`, [id]);
      if (personRows.length > 0) {
        const personId = personRows[0].ID;
        const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const [mRows] = await hosofficePool.query(
          `SELECT * FROM service_work_scans_morning WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1`,
          [personId, targetMonth]
        );
        if (mRows.length > 0) {
          const row = mRows[0];
          dayNums.forEach(d => {
            const col  = `di${d}`;
            const val  = row[col];
            if (val && typeof val === 'string' && val.trim() !== '' && !/^\d{2}:\d{2}/.test(val)) {
              leaves.push({ day: d, reason: val });
            }
          });
        }
      }
    } catch (leaveErr) {
      console.warn('[schedule/staff] leave query failed:', leaveErr.message);
    }
    res.json({ success: true, staffId: id, yearMonth, shifts, times, leaves });
  } catch (err) {
    console.error('Error in /api/schedule/staff:', err);
    res.status(500).json({ error: 'Failed to load staff schedule', shifts: [], times: [], leaves: [] });
  }
};
