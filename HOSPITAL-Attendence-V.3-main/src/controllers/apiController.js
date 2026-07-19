const fs = require('fs');
const path = require('path');
const { hosofficePool } = require('../config/db');

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
    
    // Map shifts
    employees.forEach(e => {
      if (shiftMap[e.id]) e.shift = shiftMap[e.id];
    });
    
    // 2. Fetch realtime live scans from Hikvision
    let liveScansQuery = `
      SELECT 
        h.Direction as type,
        CONCAT(p.HR_FNAME, '   ', p.HR_LNAME) as name,
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

exports.getMonthlyReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const targetMonth = `${year}-${month.toString().padStart(2, '0')}`;
    const workStart = '08:00'; 
    const lateMin = 31;
    const [h, m] = workStart.split(':').map(Number);
    const lateThreshold = (h * 60 + m + lateMin);
    const lateThresholdTime = `${Math.floor(lateThreshold/60).toString().padStart(2,'0')}:${(lateThreshold%60).toString().padStart(2,'0')}:00`;

    const currentUser = req.session.user;
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super');

    let monthlyQuery = `
      SELECT 
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        d.HR_DEPARTMENT_NAME AS dept,
        COUNT(DISTINCT h.AccessDate) as daysWorked,
        SUM(CASE WHEN h.time_in > ? THEN 1 ELSE 0 END) as lateCount,
        SUM(TIMESTAMPDIFF(MINUTE, h.time_in, h.time_out)) / 60 as totalHours
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN (
        SELECT 
          EmployeeID, 
          AccessDate,
          MIN(AccessTime) as time_in,
          MAX(AccessTime) as time_out
        FROM hikvision 
        WHERE AccessDate LIKE ? 
        GROUP BY EmployeeID, AccessDate
      ) h ON p.FINGLE_ID = h.EmployeeID
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
    `;
    const monthlyParams = [lateThresholdTime, `${targetMonth}-%`];
    if (!isPrivileged) {
      monthlyQuery += ` AND p.ID = ?`;
      monthlyParams.push(currentUser.id);
    }
    monthlyQuery += ` GROUP BY p.FINGLE_ID HAVING daysWorked > 0`;

    const [monthlyData] = await hosofficePool.query(monthlyQuery, monthlyParams);

    res.json({ success: true, report: monthlyData });
  } catch (error) {
    console.error('Monthly Report Error:', error);
    res.status(500).json({ success: false, report: [] });
  }
};
