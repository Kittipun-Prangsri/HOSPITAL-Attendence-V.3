const { pool, hosofficePool } = require('../config/db');

const OFF_SHIFTS = new Set(['', 'OFF', 'EMPTY']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const scheduleKey = (employeeId, date) => `${employeeId}\u0000${date}`;

function validEmployeeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 50;
}

function validShift(value) {
  return typeof value === 'string' && value.length <= 50;
}

function isWorkingShift(value) {
  return validShift(value) && !OFF_SHIFTS.has(value.trim().toUpperCase());
}

async function auditScheduleChange(connection, employeeId, date, previousShift, newShift, changedBy) {
  await connection.query(
    `INSERT INTO schedule_audit_log (employee_id, schedule_date, previous_shift, new_shift, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [employeeId, date, previousShift || null, newShift || null, changedBy || null]
  );
}

exports.getSchedule = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT employee_id AS emp_id, shift, DATE_FORMAT(schedule_date, \'%Y-%m-%d\') AS date FROM schedule_entries ORDER BY schedule_date, employee_id'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error reading schedules:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
};

exports.postSchedule = async (req, res) => {
  const { emp_id: employeeId, shift, date } = req.body;
  if (!validEmployeeId(employeeId) || !DATE_RE.test(date || '') || !validShift(shift)) {
    return res.status(400).json({ error: 'Invalid employee, date, or shift' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query(
      'SELECT shift FROM schedule_entries WHERE employee_id = ? AND schedule_date = ? FOR UPDATE',
      [employeeId, date]
    );
    const previousShift = existing[0]?.shift;
    if (isWorkingShift(shift)) {
      await connection.query(
        `INSERT INTO schedule_entries (employee_id, schedule_date, shift, created_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE shift = VALUES(shift), created_by = VALUES(created_by)`,
        [employeeId, date, shift.trim(), req.session.user.username]
      );
    } else {
      await connection.query('DELETE FROM schedule_entries WHERE employee_id = ? AND schedule_date = ?', [employeeId, date]);
    }
    await auditScheduleChange(connection, employeeId, date, previousShift, isWorkingShift(shift) ? shift.trim() : null, req.session.user.username);
    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('Error writing schedule:', err);
    res.status(500).json({ error: 'Failed to save schedule' });
  } finally {
    connection.release();
  }
};

exports.saveMonthlySchedule = async (req, res) => {
  const { year, month, schedule } = req.body;
  const yearNum = Number(year);
  const monthNum = Number(month);
  if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100 || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12 || !schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    return res.status(400).json({ error: 'Invalid year, month, or schedule payload' });
  }

  const yearMonth = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const entries = [];
  for (const [employeeId, days] of Object.entries(schedule)) {
    if (!validEmployeeId(employeeId) || !days || typeof days !== 'object' || Array.isArray(days)) {
      return res.status(400).json({ error: 'Invalid schedule employee entry' });
    }
    for (const [day, shift] of Object.entries(days)) {
      const dayNum = Number(day);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > daysInMonth || !validShift(shift)) {
        return res.status(400).json({ error: 'Invalid schedule day or shift' });
      }
      if (isWorkingShift(shift)) entries.push([employeeId, `${yearMonth}-${String(dayNum).padStart(2, '0')}`, shift.trim(), req.session.user.username]);
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [oldEntries] = await connection.query(
      `SELECT employee_id, DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date, shift
       FROM schedule_entries WHERE schedule_date >= ? AND schedule_date < DATE_ADD(?, INTERVAL 1 MONTH) FOR UPDATE`,
      [`${yearMonth}-01`, `${yearMonth}-01`]
    );
    await connection.query('DELETE FROM schedule_entries WHERE schedule_date >= ? AND schedule_date < DATE_ADD(?, INTERVAL 1 MONTH)', [`${yearMonth}-01`, `${yearMonth}-01`]);
    if (entries.length > 0) {
      await connection.query('INSERT INTO schedule_entries (employee_id, schedule_date, shift, created_by) VALUES ?', [entries]);
    }
    const oldMap = new Map(oldEntries.map(row => [scheduleKey(row.employee_id, row.schedule_date), row.shift]));
    for (const [employeeId, date, shift] of entries) {
      const oldShift = oldMap.get(scheduleKey(employeeId, date));
      if (oldShift !== shift) await auditScheduleChange(connection, employeeId, date, oldShift, shift, req.session.user.username);
      oldMap.delete(scheduleKey(employeeId, date));
    }
    for (const [key, oldShift] of oldMap) {
      const [employeeId, date] = key.split('\u0000');
      await auditScheduleChange(connection, employeeId, date, oldShift, null, req.session.user.username);
    }
    await connection.commit();
    res.json({ success: true, entries: entries.length });
  } catch (err) {
    await connection.rollback();
    console.error('Error saving monthly schedule:', err);
    res.status(500).json({ error: 'Failed to save schedule' });
  } finally {
    connection.release();
  }
};

exports.loadMonthlySchedule = async (req, res) => {
  const { year, month } = req.query;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  if (!YEAR_MONTH_RE.test(yearMonth)) return res.status(400).json({ error: 'Invalid year/month' });
  try {
    const [rows] = await pool.query(
      `SELECT employee_id, DAY(schedule_date) AS day, shift
       FROM schedule_entries WHERE schedule_date >= ? AND schedule_date < DATE_ADD(?, INTERVAL 1 MONTH)`,
      [`${yearMonth}-01`, `${yearMonth}-01`]
    );
    const schedule = {};
    rows.forEach(row => {
      if (!schedule[row.employee_id]) schedule[row.employee_id] = {};
      schedule[row.employee_id][row.day] = row.shift;
    });
    res.json({ success: true, data: rows.length ? { year: Number(year), month: Number(month), schedule } : null });
  } catch (err) {
    console.error('Error loading monthly schedule:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
};

exports.getStaffSchedule = async (req, res) => {
  try {
    const { id, yearMonth } = req.params;
    if (!validEmployeeId(id) || !YEAR_MONTH_RE.test(yearMonth)) return res.status(400).json({ error: 'Invalid staff or yearMonth' });
    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');
    if (!isPrivileged) {
      const [userRows] = await hosofficePool.query('SELECT FINGLE_ID FROM hr_person WHERE ID = ?', [currentUser.id]);
      if (String(id) !== String(userRows[0]?.FINGLE_ID || '')) return res.status(403).json({ error: 'Forbidden: You can only access your own schedule' });
    }

    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const [scheduleRows] = await pool.query(
      `SELECT DAY(schedule_date) AS day, shift FROM schedule_entries
       WHERE employee_id = ? AND schedule_date >= ? AND schedule_date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY schedule_date`,
      [id, `${yearMonth}-01`, `${yearMonth}-01`]
    );
    const shifts = scheduleRows.map(row => ({ day: row.day, shift: row.shift }));

    let times = [];
    try {
      const [rows] = await hosofficePool.query(
        `SELECT DAY(AccessDate) AS day, MIN(AccessTime) AS time_in, MAX(AccessTime) AS time_out
         FROM hikvision WHERE EmployeeID = ? AND AccessDate LIKE ? GROUP BY DAY(AccessDate) ORDER BY day`,
        [id, `${yearMonth}-%`]
      );
      times = rows.map(row => ({ day: row.day, time_in: row.time_in, time_out: row.time_out }));
    } catch (dbErr) { console.warn('[schedule/staff] hikvision query failed:', dbErr.message); }

    let leaves = [];
    try {
      const [personRows] = await hosofficePool.query('SELECT ID FROM hr_person WHERE FINGLE_ID = ? LIMIT 1', [id]);
      if (personRows.length > 0) {
        const [mRows] = await hosofficePool.query('SELECT * FROM service_work_scans_morning WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1', [personRows[0].ID, yearMonth]);
        if (mRows.length > 0) {
          Array.from({ length: daysInMonth }, (_, i) => i + 1).forEach(day => {
            const value = mRows[0][`di${day}`];
            if (value && typeof value === 'string' && value.trim() !== '' && !/^\d{2}:\d{2}/.test(value)) leaves.push({ day, reason: value });
          });
        }
      }
    } catch (leaveErr) { console.warn('[schedule/staff] leave query failed:', leaveErr.message); }
    res.json({ success: true, staffId: id, yearMonth, shifts, times, leaves });
  } catch (err) {
    console.error('Error in /api/schedule/staff:', err);
    res.status(500).json({ error: 'Failed to load staff schedule', shifts: [], times: [], leaves: [] });
  }
};

exports.getScheduleAudit = async (req, res) => {
  try {
    const { employee_id: employeeId, start, end } = req.query;
    const conditions = [];
    const params = [];
    if (employeeId) {
      if (!validEmployeeId(employeeId)) return res.status(400).json({ error: 'Invalid employee_id' });
      conditions.push('employee_id = ?');
      params.push(employeeId);
    }
    if (start) {
      if (!DATE_RE.test(start)) return res.status(400).json({ error: 'Invalid start date' });
      conditions.push('schedule_date >= ?');
      params.push(start);
    }
    if (end) {
      if (!DATE_RE.test(end)) return res.status(400).json({ error: 'Invalid end date' });
      conditions.push('schedule_date <= ?');
      params.push(end);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT employee_id, DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
              previous_shift, new_shift, changed_by, changed_at
       FROM schedule_audit_log ${whereClause}
       ORDER BY changed_at DESC LIMIT 200`,
      params
    );

    let nameMap = {};
    const employeeIds = [...new Set(rows.map(row => row.employee_id))];
    if (employeeIds.length > 0) {
      const [people] = await hosofficePool.query(
        `SELECT FINGLE_ID, CONCAT(HR_FNAME, ' ', HR_LNAME) AS name FROM hr_person WHERE FINGLE_ID IN (?)`,
        [employeeIds]
      );
      nameMap = Object.fromEntries(people.map(p => [p.FINGLE_ID, p.name]));
    }

    const log = rows.map(row => ({
      employeeId: row.employee_id,
      employeeName: nameMap[row.employee_id] || row.employee_id,
      date: row.schedule_date,
      previousShift: row.previous_shift,
      newShift: row.new_shift,
      changedBy: row.changed_by,
      changedAt: row.changed_at
    }));

    res.json({ success: true, log });
  } catch (err) {
    console.error('Error in /api/schedule/audit:', err);
    res.status(500).json({ error: 'Failed to load schedule audit log', log: [] });
  }
};
