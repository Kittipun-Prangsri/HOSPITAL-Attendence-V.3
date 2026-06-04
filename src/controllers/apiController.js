const fs = require('fs');
const path = require('path');
const { pool, hosofficePool } = require('../config/db');

const SCHEDULE_FILE = path.join(__dirname, '..', '..', 'data', 'schedule.json');

exports.getData = async (req, res) => {
  try {
    const targetDateStr = req.query.date || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(targetDateStr);
    const targetMonth = targetDateStr.substring(0, 7); // YYYY-MM
    let day = targetDateObj.getDate().toString();
    const dayColumn = `di${day}`;

    const lateMin = parseInt(req.query.lateMin) || 31;
    const workStart = req.query.workStart || '08:00';
    
    // Calculate late threshold time
    const [h, m] = workStart.split(':').map(Number);
    const lateTotalMinutes = h * 60 + m + lateMin;
    const lateH = Math.floor(lateTotalMinutes / 60).toString().padStart(2, '0');
    const lateM = (lateTotalMinutes % 60).toString().padStart(2, '0');
    const lateThresholdTime = `${lateH}:${lateM}:00`;

    // Load schedule mapping
    let shiftMap = {};
    try {
      if (fs.existsSync(SCHEDULE_FILE)) {
        const sched = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        sched.forEach(s => {
          if (s.emp_id && s.shift) {
            shiftMap[s.emp_id] = s.shift.toLowerCase();
          }
        });
      }
    } catch (e) {
      console.error('Shift load error:', e);
    }

    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    // 1. Fetch live unified employees summary
    let employeesQuery = `
      SELECT 
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        d.HR_DEPARTMENT_NAME AS dept,
        s.HR_STATUS_NAME AS role,
        COALESCE(h.time_in, '') AS \`in\`,
        COALESCE(h.time_out, '') AS \`out\`,
        m.${dayColumn} AS leave_status,
        CASE 
          WHEN m.${dayColumn} IS NOT NULL AND m.${dayColumn} != '' AND m.${dayColumn} NOT REGEXP '^[0-9]{2}:[0-9]{2}' THEN 'leave'
          WHEN h.time_in > ? THEN 'late'
          WHEN h.time_out IS NOT NULL AND h.time_out != h.time_in THEN 'out'
          WHEN h.time_in IS NOT NULL THEN 'in'
          ELSE 'none' END as status,
        '' as shift, 
        '0' as hours, 
        '0' as ot, 
        100 as conf 
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON p.HR_STATUS_ID = s.HR_STATUS_ID
      LEFT JOIN (
        SELECT 
          EmployeeID, 
          MIN(AccessTime) as time_in,
          MAX(AccessTime) as time_out
        FROM hikvision 
        WHERE AccessDate = ? 
        GROUP BY EmployeeID
      ) h ON p.FINGLE_ID = h.EmployeeID
      LEFT JOIN service_work_scans_morning m ON p.ID = m.hr_person_id AND m.year_and_month = ?
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
    `;
    const employeesParams = [lateThresholdTime, targetDateStr, targetMonth];
    if (!isPrivileged) {
      employeesQuery += ` AND p.ID = ?`;
      employeesParams.push(currentUser.id);
    }
    employeesQuery += ` ORDER BY d.HR_DEPARTMENT_ID, p.FINGLE_ID`;

    const [employees] = await hosofficePool.query(employeesQuery, employeesParams);
    
    // Map shifts & calculate hours
    employees.forEach(e => {
      if (shiftMap[e.id]) e.shift = shiftMap[e.id];
      
      if (e.in && e.out && e.in !== e.out) {
        try {
          const [inH, inM] = e.in.split(':').map(Number);
          const [outH, outM] = e.out.split(':').map(Number);
          if (!isNaN(inH) && !isNaN(inM) && !isNaN(outH) && !isNaN(outM)) {
            let totalMins = (outH * 60 + outM) - (inH * 60 + inM);
            if (totalMins < 0) totalMins += 24 * 60; // Rollover midnight
            e.hours = (totalMins / 60).toFixed(1);
          }
        } catch (err) {
          console.error('Error calculating hours:', err);
        }
      }
    });
    
    // 2. Fetch realtime live scans from Hikvision
    let liveScansQuery = `
      SELECT 
        h.Direction as type,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as name,
        d.HR_DEPARTMENT_NAME as dept,
        h.AccessTime as time,
        h.DeviceName,
        h.ReaderName,
        h.SkinSurfaceTemperature as temp,
        h.TemperatureStatus as tempStatus,
        CASE 
          WHEN h.Direction = 'in' THEN 'เข้างาน' 
          WHEN h.Direction = 'out' THEN 'ออกงาน' 
          ELSE 'สแกน' END as action,
        h.Direction as subType,
        '' as shift, 
        ROUND(RAND() * (99.9 - 95.0) + 95.0, 1) as conf 
      FROM hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE h.AccessDate = ?
      AND (p.HR_STATUS_ID IN ('01', '02', '03', '04', '09') OR h.PersonName IS NOT NULL)
    `;
    const liveScansParams = [targetDateStr];
    if (!isPrivileged) {
      liveScansQuery += ` AND p.ID = ?`;
      liveScansParams.push(currentUser.id);
    }
    liveScansQuery += ` ORDER BY h.AccessTime DESC LIMIT 30`;

    const [liveScans] = await hosofficePool.query(liveScansQuery, liveScansParams);

    const timelineData = liveScans.map(s => ({
      ...s,
      location: s.DeviceName || s.ReaderName || 'ไม่ทราบจุดสแกน'
    }));
    const scanQueue = timelineData.slice(0, 5); 
    
    // 3. Fetch Service Work / Leave status
    const dayColumnIn = `di${day}`;
    const dayColumnOut = `do${day}`;

    let serviceWorkQuery = `
      SELECT 
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as name,
        d.HR_DEPARTMENT_NAME as dept,
        m.${dayColumnIn} as morning,
        a.${dayColumnOut} as afternoon
      FROM hr_person p
      JOIN service_work_scans_morning m ON p.ID = m.hr_person_id
      JOIN service_work_scans_afternoon a ON p.ID = a.hr_person_id
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE m.year_and_month = ? AND a.year_and_month = ?
      AND (
        (m.${dayColumnIn} IS NOT NULL AND m.${dayColumnIn} != '' AND m.${dayColumnIn} NOT REGEXP '[0-9]{2}:[0-9]{2}')
        OR
        (a.${dayColumnOut} IS NOT NULL AND a.${dayColumnOut} != '' AND a.${dayColumnOut} NOT REGEXP '[0-9]{2}:[0-9]{2}')
      )
    `;
    const serviceWorkParams = [targetMonth, targetMonth];
    if (!isPrivileged) {
      serviceWorkQuery += ` AND p.ID = ?`;
      serviceWorkParams.push(currentUser.id);
    }

    const [serviceWorkData] = await hosofficePool.query(serviceWorkQuery, serviceWorkParams);

    res.json({ employees, timelineData, scanQueue, serviceWorkData });
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ employees: [], timelineData: [], scanQueue: [] });
  }
};

async function syncIncidentsForMonth(year, month) {
  const targetMonth = `${year}-${month.toString().padStart(2, '0')}`;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  let endDay = daysInMonth;
  if (year === currentYear && month === currentMonth) {
    endDay = now.getDate() - 1; // Sync up to yesterday
  } else if (year > currentYear || (year === currentYear && month > currentMonth)) {
    endDay = 0; // Future, don't sync
  }

  if (endDay <= 0) return;

  // 1. Get active employees
  const [employees] = await hosofficePool.query(`
    SELECT hp.ID, hp.FINGLE_ID, hp.HR_CID,
           COALESCE(hht.TEMPLATE_ID, 1) AS TEMPLATE_ID
    FROM hr_person hp
    LEFT JOIN hr_person_hiling_time hht ON hht.HR_PERSON_ID = hp.ID
    WHERE hp.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
      AND hp.FINGLE_ID IS NOT NULL AND hp.FINGLE_ID != ''
  `);

  if (employees.length === 0) return;

  // 2. Get hikvision scans for the month
  const [scans] = await hosofficePool.query(`
    SELECT EmployeeID, AccessDate, MIN(AccessTime) as time_in
    FROM hikvision
    WHERE AccessDate LIKE ?
    GROUP BY EmployeeID, AccessDate
  `, [`${targetMonth}-%`]);

  // Map scans: { [EmployeeID]: { [AccessDate]: time_in } }
  const scansMap = {};
  for (const s of scans) {
    if (!scansMap[s.EmployeeID]) scansMap[s.EmployeeID] = {};
    scansMap[s.EmployeeID][s.AccessDate] = s.time_in;
  }

  // 3. Get leaves schedule for the month
  const [leaves] = await hosofficePool.query(`
    SELECT hr_person_id,
           di1, di2, di3, di4, di5, di6, di7, di8, di9, di10,
           di11, di12, di13, di14, di15, di16, di17, di18, di19, di20,
           di21, di22, di23, di24, di25, di26, di27, di28, di29, di30, di31
    FROM service_work_scans_morning
    WHERE year_and_month = ?
  `, [targetMonth]);

  const leavesMap = {};
  for (const l of leaves) {
    leavesMap[l.hr_person_id] = l;
  }

  // 4. Get excuses from local DB (using pool)
  const [excuses] = await pool.query(`
    SELECT username, date, status, issue_type
    FROM attendance_excuses
    WHERE date LIKE ? AND status = 'approved'
  `, [`${targetMonth}-%`]);

  const excusesMap = {};
  for (const e of excuses) {
    if (!excusesMap[e.username]) excusesMap[e.username] = {};
    const dateKey = e.date instanceof Date ? e.date.toISOString().split('T')[0] : e.date;
    excusesMap[e.username][dateKey] = e.status;
  }

  // 5. Get existing incidents
  const [incidents] = await pool.query(`
    SELECT employee_id, incident_date, incident_type, status
    FROM incident_logs
    WHERE incident_date LIKE ?
  `, [`${targetMonth}-%`]);

  const incidentsMap = {};
  for (const inc of incidents) {
    const dateKey = inc.incident_date instanceof Date ? inc.incident_date.toISOString().split('T')[0] : inc.incident_date;
    if (!incidentsMap[inc.employee_id]) incidentsMap[inc.employee_id] = {};
    if (!incidentsMap[inc.employee_id][dateKey]) {
      incidentsMap[inc.employee_id][dateKey] = {};
    }
    incidentsMap[inc.employee_id][dateKey][inc.incident_type] = inc.status;
  }

  // 6. Process days and build sync array
  const insertValues = [];
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  for (const emp of employees) {
    const pId = emp.ID;
    const fingleId = emp.FINGLE_ID;
    const cid = emp.HR_CID;
    const templateId = emp.TEMPLATE_ID;

    for (let d = 1; d <= endDay; d++) {
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      
      // Skip if it is today
      if (dateStr === todayStr) continue;

      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

      // Check leave in schedule
      const leaveRow = leavesMap[pId];
      const leaveVal = leaveRow ? leaveRow[`di${d}`] : null;
      const isScheduledLeave = leaveVal && leaveVal.trim() !== '' && !/^\d{2}:\d{2}/.test(leaveVal);

      if (isScheduledLeave) {
        continue;
      }

      const checkInTime = scansMap[fingleId]?.[dateStr];
      const hasCheckedIn = !!checkInTime;

      if (hasCheckedIn) {
        // Check if late (Threshold 08:30)
        const [sh, sm] = checkInTime.split(':').map(Number);
        const isLate = (sh > 8) || (sh === 8 && sm >= 31);

        if (isLate) {
          const excuseStatus = excusesMap[cid]?.[dateStr];
          const currentStatus = incidentsMap[fingleId]?.[dateStr]?.['LATE'];

          let status = 'PENDING';
          if (excuseStatus === 'approved') {
            status = 'SUBMITTED';
          } else if (currentStatus) {
            status = currentStatus;
          }

          insertValues.push([fingleId, dateStr, 'LATE', status]);
        }
      } else {
        // No check-in
        if (templateId === 2 || !isWeekend) {
          const excuseStatus = excusesMap[cid]?.[dateStr];
          const currentStatus = incidentsMap[fingleId]?.[dateStr]?.['ABSENT'];

          let status = 'PENDING';
          if (excuseStatus === 'approved') {
            status = 'SUBMITTED';
          } else {
            // Overdue if older than 3 days
            const incidentDateObj = new Date(dateStr);
            const diffTime = Math.abs(now - incidentDateObj);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 3) {
              status = 'OVERDUE';
            } else if (currentStatus) {
              status = currentStatus;
            }
          }

          insertValues.push([fingleId, dateStr, 'ABSENT', status]);
        }
      }
    }
  }

  // 7. Bulk Insert / Upsert
  if (insertValues.length > 0) {
    const queryStr = `
      INSERT INTO incident_logs (employee_id, incident_date, incident_type, status)
      VALUES ?
      ON DUPLICATE KEY UPDATE 
        status = VALUES(status)
    `;
    const chunkSize = 1000;
    for (let i = 0; i < insertValues.length; i += chunkSize) {
      const chunk = insertValues.slice(i, i + chunkSize);
      await pool.query(queryStr, [chunk]);
    }
  }
}

exports.getMonthlyReport = async (req, res) => {
  try {
    const { month, year, department, search } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Missing month or year parameter' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const targetMonth = `${yearNum}-${monthNum.toString().padStart(2, '0')}`;

    // Sync incidents for the selected month dynamically
    await syncIncidentsForMonth(yearNum, monthNum);

    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    const hospitalDb = process.env.DB_NAME_HOSPITAL || 'hospital_db';

    let query = `
      SELECT 
        p.ID,
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        COALESCE(htt.HILING_TIME_NAME, d.HR_DEPARTMENT_NAME, 'ไม่ระบุแผนก') AS dept,
        p.HR_STATUS_ID AS role,
        COALESCE(h.daysPresent, 0) as daysPresent,
        COALESCE(i.lateCount, 0) as lateCount,
        COALESCE(i.absentCount, 0) as absentCount,
        COALESCE(i.overdueCount, 0) as overdueCount
      FROM hr_person p
      LEFT JOIN hr_person_hiling_time hht ON hht.HR_PERSON_ID = p.ID
      LEFT JOIN hiling_time_template htt ON htt.ID = hht.TEMPLATE_ID
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN (
        SELECT EmployeeID, COUNT(DISTINCT AccessDate) as daysPresent
        FROM hikvision
        WHERE AccessDate LIKE ?
        GROUP BY EmployeeID
      ) h ON p.FINGLE_ID = h.EmployeeID
      LEFT JOIN (
        SELECT 
          employee_id,
          SUM(CASE WHEN incident_type = 'LATE' THEN 1 ELSE 0 END) as lateCount,
          SUM(CASE WHEN incident_type = 'ABSENT' THEN 1 ELSE 0 END) as absentCount,
          SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdueCount
        FROM ${hospitalDb}.incident_logs
        WHERE incident_date LIKE ?
        GROUP BY employee_id
      ) i ON p.FINGLE_ID = i.employee_id
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
    `;

    const params = [`${targetMonth}-%`, `${targetMonth}-%`];

    if (!isPrivileged) {
      query += ` AND p.ID = ?`;
      params.push(currentUser.id);
    }

    if (department) {
      query += ` AND (htt.HILING_TIME_NAME = ? OR d.HR_DEPARTMENT_NAME = ?)`;
      params.push(department, department);
    }

    if (search) {
      query += ` AND (CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) LIKE ? OR p.FINGLE_ID LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY d.HR_DEPARTMENT_ID, p.FINGLE_ID`;

    const [reportData] = await hosofficePool.query(query, params);

    // Fetch leaves count for the month
    const [leaves] = await hosofficePool.query(`
      SELECT hr_person_id,
             di1, di2, di3, di4, di5, di6, di7, di8, di9, di10,
             di11, di12, di13, di14, di15, di16, di17, di18, di19, di20,
             di21, di22, di23, di24, di25, di26, di27, di28, di29, di30, di31
      FROM service_work_scans_morning
      WHERE year_and_month = ?
    `, [targetMonth]);

    const leavesCountMap = {};
    for (const l of leaves) {
      let count = 0;
      for (let d = 1; d <= 31; d++) {
        const val = l[`di${d}`];
        if (val && val.trim() !== '' && !/^\d{2}:\d{2}/.test(val)) {
          count++;
        }
      }
      leavesCountMap[l.hr_person_id] = count;
    }

    // Merge leaves count into reportData
    const finalReport = reportData.map(person => {
      const leaveCount = leavesCountMap[person.ID] || 0;
      const daysPresent = Number(person.daysPresent || 0);
      const lateCount = Number(person.lateCount || 0);
      const absentCount = Number(person.absentCount || 0);
      const overdueCount = Number(person.overdueCount || 0);

      // Determine status
      let status = 'ปกติ';
      if (absentCount > 0 || lateCount > 3) {
        status = 'ต้องปรับปรุง';
      } else if (overdueCount > 0) {
        status = 'รอดำเนินการ (Overdue)';
      }

      return {
        ...person,
        daysPresent,
        lateCount,
        absentCount,
        overdueCount,
        leaveCount,
        status
      };
    });

    res.json({ success: true, report: finalReport });
  } catch (error) {
    console.error('Monthly Report Aggregation Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', report: [] });
  }
};
