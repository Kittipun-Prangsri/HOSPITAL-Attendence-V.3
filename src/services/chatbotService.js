const { hosofficePool } = require('../config/db');
const flexBuilder = require('./flexBuilder');
const { getLateThreshold } = require('./workSettings');
const { isLateCheckIn, normalizeClock, toDateKey } = require('../utils/attendanceTime');
const { pool } = require('../config/db');
const { fiscalYearOf, summarizeBalance } = require('../utils/leave');
const { quotasForEmployee } = require('./leavePolicy');
const { personByChatId } = require('./messagingLinks');

class ChatbotService {
  /**
   * Handle incoming postback events from LINE Flex buttons (Returns LINE Flex Bubble Object)
   */
  async handlePostback(data, userId) {
    if (!data) return null;
    const params = new URLSearchParams(data);
    const action = params.get('action');

    if (action === 'today_history' || action === 'history') {
      return await this.handleTodayScansFlex(userId);
    }
    if (action === 'latest_scan') {
      return await this.handleLatestScanFlex(userId);
    }
    if (action === 'leave_balance') {
      return await this.handleLeaveBalance(userId);
    }
    if (action === 'excuse' || action === 'leave') {
      let fullname = 'บุคลากร';
      let empId = '';
      if (userId) {
        try {
          const [person] = await this.chatPersonQuery(userId, `FINGLE_ID, CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname`);
          if (person.length > 0) {
            empId = person[0].FINGLE_ID;
            fullname = person[0].fullname.trim();
          }
        } catch (err) {
          console.error('[Chatbot] Error querying user info for excuse Flex:', err.message);
        }
      }
      return flexBuilder.buildExcuseFlex({ fullname, employeeId: empId });
    }
    return null;
  }

  /**
   * Helper to return today scans as a polished LINE Flex Message Bubble
   */
  /**
   * The realtime scan card, on demand. Sent as a reply (free, no LINE push quota), so staff who don't
   * get pushed cards can still see their latest scan by tapping a button or typing "สแกนล่าสุด".
   */
  async handleLatestScanFlex(userId) {
    const me = await this.resolveRequester(userId);
    if (!me) {
      return 'บัญชีนี้ยังไม่ได้ผูกกับรหัสพนักงาน\nพิมพ์ "ขอไอดี" เพื่อรับไอดี แล้วแจ้งฝ่าย IT / HR ให้ผูกกับข้อมูลบุคลากรครับ';
    }
    try {
      const [[person]] = await hosofficePool.query(
        "SELECT CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) AS fullname FROM hr_person WHERE FINGLE_ID = ? LIMIT 1", [me.empId]);
      // Most recent scan in the last 7 days (a card from last week is still useful after a holiday)
      const [[scan]] = await hosofficePool.query(`
        SELECT AccessDate, AccessTime, Direction, AttendanceStatus, AuthenticationResult, DeviceName, SkinSurfaceTemperature
        FROM hikvision
        WHERE EmployeeID = ? AND AccessDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        ORDER BY AccessDate DESC, AccessTime DESC
        LIMIT 1
      `, [me.empId]);
      const fullname = (person && person.fullname || me.empId).trim();
      if (!scan) return `📇 คุณ${fullname}\nยังไม่พบการสแกนใน 7 วันที่ผ่านมาครับ`;

      const dir = String(scan.Direction || '').toLowerCase();
      const st = String(scan.AttendanceStatus || '').toLowerCase();
      const isCheckIn = ['in', 'i', 'check-in'].includes(dir) || ['in', 'i', 'check-in'].includes(st);
      const isLate = isCheckIn && isLateCheckIn(normalizeClock(scan.AccessTime) || '', await getLateThreshold());
      const dateThai = new Date(`${toDateKey(scan.AccessDate)}T00:00:00+07:00`)
        .toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });

      return flexBuilder.buildAttendanceFlex({
        fullname,
        employeeId: me.empId,
        direction: scan.Direction,
        attendanceStatus: scan.AttendanceStatus,
        authResult: scan.AuthenticationResult,
        dateThai,
        timeStr: scan.AccessTime,
        deviceName: scan.DeviceName || 'ไม่ระบุจุดสแกน',
        temperature: scan.SkinSurfaceTemperature,
        isLate
      });
    } catch (err) {
      console.error('[Chatbot] latest scan card failed:', err.message);
      return 'ขออภัยครับ ดึงข้อมูลการสแกนล่าสุดไม่สำเร็จ ลองใหม่อีกครั้ง';
    }
  }

  /** Remaining leave days for the current fiscal year (own data only), same numbers as the leave page. */
  async handleLeaveBalance(userId) {
    const me = await this.resolveRequester(userId);
    if (!me) return 'บัญชีนี้ยังไม่ได้ผูกกับรหัสพนักงาน\nพิมพ์ "ขอไอดี" แล้วแจ้งฝ่าย IT / HR ให้ผูกบัญชีครับ';
    try {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const fy = fiscalYearOf(today);
      const [[rows], { quotas }, [[person]]] = await Promise.all([
        pool.query(
          `SELECT leave_type, days, status FROM leave_requests
           WHERE employee_id = ? AND start_date BETWEEN ? AND ? AND status IN ('approved', 'pending')`,
          [me.empId, fy.start, fy.end]),
        quotasForEmployee(me.empId),
        hosofficePool.query("SELECT CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) AS fullname FROM hr_person WHERE FINGLE_ID = ? LIMIT 1", [me.empId])
      ]);
      const balance = summarizeBalance(rows, quotas);
      const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
      // Main types always; the rest only when they were used this year
      const lines = Object.entries(balance)
        .filter(([key, b]) => ['sick', 'personal', 'vacation'].includes(key) || b.used || b.pending)
        .filter(([, b]) => b.quota !== 0)
        .map(([, b]) => {
          const extra = [b.used ? `ใช้ ${fmt(b.used)}` : '', b.pending ? `รออนุมัติ ${fmt(b.pending)}` : ''].filter(Boolean).join(' · ');
          const left = b.remaining == null ? 'ไม่จำกัด' : `เหลือ ${fmt(b.remaining)} วัน`;
          return `• ${b.label}: ${left}${extra ? ` (${extra})` : ''}`;
        });
      const base = (process.env.SYSTEM_URL || '').trim().replace(/\/+$/, '');
      return `🏖️ สิทธิ์ลาคงเหลือ ปีงบประมาณ ${fy.label}\n👤 ${(person && person.fullname || me.empId).trim()}\n\n${lines.join('\n')}` +
        (base.startsWith('http') ? `\n\nยื่นลาออนไลน์: ${base}/leave` : '');
    } catch (err) {
      console.error('[Chatbot] leave balance failed:', err.message);
      return 'ขออภัยครับ คำนวณสิทธิ์ลาไม่สำเร็จ ลองใหม่อีกครั้ง';
    }
  }

  async handleTodayScansFlex(userId) {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const todayThai = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let fullname = 'บุคลากร';
    let empId = '';
    let scans = [];

    if (userId) {
      try {
        const [person] = await this.chatPersonQuery(userId, `FINGLE_ID, CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname`);

        if (person.length > 0) {
          empId = person[0].FINGLE_ID;
          fullname = person[0].fullname.trim();

          const [userScans] = await hosofficePool.query(`
            SELECT AccessTime, DeviceName
            FROM hikvision
            WHERE EmployeeID = ?
              AND AccessDate = ?
              AND AuthenticationResult = 'Success'
            ORDER BY AccessTime ASC
          `, [empId, todayStr]);

          scans = userScans;
        }
      } catch (err) {
        console.error('[Chatbot] Error querying user personal scans for Flex:', err.message);
      }
    }

    return flexBuilder.buildHistoryFlex({
      fullname,
      employeeId: empId,
      dateThai: todayThai,
      scans
    });
  }

  /**
   * Main entry point to handle incoming text messages
   */
  /**
   * hr_person row(s) for the staff member linked to this LINE user id / Telegram chat id, in the
   * same [rows] shape as pool.query. Links come from hospital_db.messaging_links only.
   */
  async chatPersonQuery(userId, cols) {
    const personId = await personByChatId(userId);
    if (!personId) return [[]];
    return hosofficePool.query(`SELECT ${cols} FROM hr_person WHERE ID = ? LIMIT 1`, [personId]);
  }

  /**
   * Who is asking: the staff record linked to this LINE userId / Telegram chat id.
   * Scan history is personal data (PDPA), so only linked staff may query it, regular staff
   * only their own, and only ADMIN / SUPER accounts may look up other people or the whole hospital.
   */
  async resolveRequester(userId) {
    if (!userId) return null;
    try {
      const [rows] = await this.chatPersonQuery(userId, `FINGLE_ID, UPPER(COALESCE(USER_TYPE, '')) AS user_type`);
      if (!rows.length || !rows[0].FINGLE_ID) return null;
      return { empId: String(rows[0].FINGLE_ID), isAdmin: ['ADMIN', 'SUPER'].includes(rows[0].user_type) };
    } catch (err) {
      console.error('[Chatbot] requester lookup failed:', err.message);
      return null;
    }
  }

  /** Returns { filter } to use for a scan query, or { deny } with the reply to send instead. */
  async scanScope(userId, nameFilter) {
    const me = await this.resolveRequester(userId);
    if (!me) {
      return { deny: 'บัญชีนี้ยังไม่ได้ผูกกับรหัสพนักงาน จึงดูประวัติการสแกนไม่ได้\n\n' +
        'พิมพ์ "ขอไอดี" เพื่อรับไอดี แล้วแจ้งฝ่าย IT / HR ให้ผูกกับข้อมูลบุคลากรครับ' };
    }
    if (me.isAdmin) return { filter: nameFilter, empId: null };
    const note = nameFilter && nameFilter !== me.empId ? 'ℹ️ ดูได้เฉพาะข้อมูลของตนเอง\n\n' : '';
    return { filter: me.empId, empId: me.empId, note };
  }

  async handleMessage(text, userId) {
    if (!text) return null;
    const cleanText = text.trim();

    // Command: "ขอไอดี" / "ขอ id" / "ขอ ID" / "id" / "my id" / "ไอดี"
    const idKeywords = ['ขอไอดี', 'ขอ id', 'ขอ id', 'id', 'my id', 'ไอดี', 'ขอไอดีหน่อย', 'ขอไอดีหน่อยครับ', 'ขอไอดีหน่อยค่ะ'];
    if (idKeywords.includes(cleanText.toLowerCase())) {
      const isTelegram = /^-?\d+$/.test(userId);
      if (isTelegram) {
        return `Telegram Chat ID ของคุณคือ:\n${userId}\n\n` +
          `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'Telegram ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
      } else {
        return `LINE User ID ของคุณคือ:\n${userId}\n\n` +
          ``;
      }
    }

    // Command: "ขอรหัสemployeeid"
    if (cleanText.toLowerCase() === 'ขอรหัสemployeeid') {
      console.log(`[Chatbot] Looking up EmployeeID for platform ID: ${userId}...`);
      try {
        const [rows] = await this.chatPersonQuery(userId, `FINGLE_ID`);

        if (rows.length > 0 && rows[0].FINGLE_ID) {
          return `เลขรหัสของคุณคือ : ${rows[0].FINGLE_ID}`;
        } else {
          return 'ขออภัยครับ ไม่พบข้อมูลรหัสพนักงานที่ผูกกับบัญชีของคุณ กรุณาติดต่อฝ่าย IT';
        }
      } catch (err) {
        console.error('[Chatbot] Lookup employee ID error:', err.message);
        return 'ขออภัยครับ ไม่พบข้อมูลรหัสพนักงานที่ผูกกับบัญชีของคุณ กรุณาติดต่อฝ่าย IT';
      }
    }
    // Command: "ลงทะเบียนใบหน้า" / "สแกนใบหน้า" → LIFF link (a reply, so no push quota)
    if (/^(?:ลงทะเบียนใบหน้า|สแกนใบหน้า|สแกนหน้า|ใบหน้า|face)$/i.test(cleanText)) {
      const liffId = (process.env.LIFF_ID || '').trim();
      if (!liffId) return 'ระบบสแกนใบหน้าผ่านมือถือยังไม่เปิดใช้งานครับ';
      return `📸 ลงทะเบียน / สแกนใบหน้าผ่านมือถือ\nกดลิงก์นี้ (เปิดใน LINE):\nhttps://liff.line.me/${liffId}\n\nครั้งแรกต้องอ่านและกดยินยอมการใช้ข้อมูลใบหน้า แล้วรอผู้ดูแลระบบอนุมัติครับ`;
    }
    // Command: "ยื่นใบลา" / "แจ้งเหตุสาย" / "แจ้งเหตุ" / "ขอใบลา"
    const excuseKeywords = ['ยื่นใบลา', 'แจ้งเหตุสาย', 'แจ้งเหตุ', 'ขอใบลา', 'ใบลา', 'แก้ต่าง', 'ยื่นใบลา / แจ้งเหตุสาย', 'ส่งใบแก้ต่าง'];
    if (excuseKeywords.some(k => cleanText.toLowerCase().includes(k))) {
      const baseUrl = process.env.SYSTEM_URL || process.env.DOMAIN || '';
      const linkMsg = baseUrl && baseUrl.startsWith('http')
        ? `\n🔗 ลิงก์ยื่นใบลาออนไลน์: ${baseUrl}/excuses`
        : '';
      return `📝 *ระบบแจ้งสาเหตุการลงเวลา / ยื่นใบลา*\n\n` +
             `ท่านสามารถแจ้งเหตุผลการเข้างานสาย ลืมสแกน หรือยื่นใบลาออนไลน์ได้ที่ระบบ${linkMsg}\n\n` +
             `หรือติดต่อเจ้าหน้าที่งานบริหารทรัพยากรบุคคล (HR) โรงพยาบาลคลองหาดครับ`;
    }

    // 1. Command: "ขอดูการสแกนวันนี้" / "ดูประวัติการเข้างาน" [EmployeeID/Name]
    const todayRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)วันนี้|ดูประวัติ(?:การเข้างาน|การสแกน|ประวัติ)?|ประวัติ|1|scan_today)(?:\s+(.+))?$/i;
    const todayMatch = cleanText.match(todayRegex);
    if (todayMatch) {
      const nameFilter = todayMatch[1] ? todayMatch[1].trim() : null;
      const scope = await this.scanScope(userId, nameFilter);
      if (scope.deny) return scope.deny;
      return (scope.note || '') + await this.handleTodayScans(scope.filter);
    }

    // 1b. Command: "ขอดูการสแกนเมื่อวาน [EmployeeID/Name]" (supports ขอดูการสแกนเมื่อวาน, ขอดูย้อนหลังเมื่อวาน, เลข 2, หรือ scan_yesterday)
    const yesterdayRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)เมื่อวาน|ขอดูย้อนหลังเมื่อวาน|2|scan_yesterday)(?:\s+(.+))?$/i;
    const yesterdayMatch = cleanText.match(yesterdayRegex);
    if (yesterdayMatch) {
      const nameFilter = yesterdayMatch[1] ? yesterdayMatch[1].trim() : null;
      const scope = await this.scanScope(userId, nameFilter);
      if (scope.deny) return scope.deny;
      return (scope.note || '') + await this.handleYesterdayScans(scope.filter);
    }

    // 1c. Command: "ขอดูย้อนหลัง 3 วัน [EmployeeID/Name]" (supports เลข 3 หรือ scan_3days)
    const threeDaysRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)ย้อนหลัง\s*3\s*วัน|3|scan_3days)(?:\s+(.+))?$/i;
    const threeDaysMatch = cleanText.match(threeDaysRegex);
    if (threeDaysMatch) {
      const nameFilter = threeDaysMatch[1] ? threeDaysMatch[1].trim() : null;
      const scope = await this.scanScope(userId, nameFilter);
      if (scope.deny) return scope.deny;
      return (scope.note || '') + await this.handleRangeScans(3, scope.filter);
    }

    // 1d. Command: "ขอดูย้อนหลัง 7 วัน [EmployeeID/Name]" (supports เลข 7 หรือ scan_7days)
    const sevenDaysRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)ย้อนหลัง\s*7\s*วัน|7|scan_7days)(?:\s+(.+))?$/i;
    const sevenDaysMatch = cleanText.match(sevenDaysRegex);
    if (sevenDaysMatch) {
      const nameFilter = sevenDaysMatch[1] ? sevenDaysMatch[1].trim() : null;
      const scope = await this.scanScope(userId, nameFilter);
      if (scope.deny) return scope.deny;
      return (scope.note || '') + await this.handleRangeScans(7, scope.filter);
    }

    // 2. Command: "สแกน วันที่ [วันที่]" (e.g. สแกน วันที่ 01/06/2026 or แสกนวันที่ 01.06.2569)
    const scanDateRegex = /^(?:สแกน|แสกน)\s*วันที่\s*(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/i;
    const match = cleanText.match(scanDateRegex);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-based index
      const year = parseInt(match[3], 10);

      // Convert Buddhist Era (พ.ศ.) to Christian Era (ค.ศ.) if necessary
      let adYear = year;
      if (year > 2400) {
        adYear = year - 543;
      }

      // Validate date validity (e.g. prevent 31/02/2026)
      const dateObj = new Date(adYear, month, day);
      if (
        dateObj.getFullYear() === adYear &&
        dateObj.getMonth() === month &&
        dateObj.getDate() === day
      ) {
        const scope = await this.scanScope(userId, null);
        if (scope.deny) return scope.deny;
        return await this.handleHistoricalScans(day, month + 1, adYear, scope.empId);
      }
    }

    // 3. Fallback for invalid format or other messages starting with chatbot keywords
    if (
      cleanText.toLowerCase().includes('สแกน') ||
      cleanText.toLowerCase().includes('แสกน') ||
      cleanText.includes('การแจ้ง')
    ) {
      return 'ขออภัยครับ ไม่พบข้อมูลในวันที่ระบุ กรุณาตรวจสอบรูปแบบวันที่อีกครั้ง';
    }

    // For other messages, return null to fallback to standard LINE ID helper message
    return null;
  }

  /**
   * Handle "ขอดูการสแกนวันนี้" command
   * Queries SQL database for DATE = CURRENT_DATE (using today in Asia/Bangkok time)
   * Can optionally filter by EmployeeID or Name
   */
  async handleTodayScans(nameFilter = null, userId = null) {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const todayThai = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Personal user lookup when clicking Flex button / requesting personal scans
    if (userId && !nameFilter) {
      try {
        const [person] = await this.chatPersonQuery(userId, `FINGLE_ID, CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname`);

        if (person.length > 0 && person[0].FINGLE_ID) {
          const empId = person[0].FINGLE_ID;
          const fullname = person[0].fullname.trim();

          const [scans] = await hosofficePool.query(`
            SELECT AccessTime, DeviceName
            FROM hikvision
            WHERE EmployeeID = ?
              AND AccessDate = ?
              AND AuthenticationResult = 'Success'
            ORDER BY AccessTime ASC
          `, [empId, todayStr]);

          if (scans.length > 0) {
            let reply = `📋 *ประวัติการสแกนวันนี้ของคุณ*\n👤 คุณ${fullname} (ID: ${empId})\n📅 วันที่: ${todayThai}\n\n`;
            scans.forEach((s, idx) => {
              reply += `${idx + 1}. ⏰ เวลา ${s.AccessTime} น. | 🚪 ${s.DeviceName || 'เครื่องสแกน'}\n`;
            });
            return reply.trim();
          } else {
            return `📋 *ประวัติการสแกนวันนี้*\n👤 คุณ${fullname} (ID: ${empId})\n📅 วันที่: ${todayThai}\n\n⚠️ ยังไม่พบรายการสแกนเข้า-ออกงานของคุณในระบบวันนี้ครับ`;
          }
        }
      } catch (err) {
        console.error('[Chatbot] Error querying user personal scans:', err.message);
      }
    }

    if (nameFilter) {
      // Check if it is an EmployeeID query (contains only alphanumeric characters, no Thai characters)
      const isIdQuery = /^[A-Za-z0-9_\-]+$/.test(nameFilter);

      if (isIdQuery) {
        console.log(`[Chatbot] Querying SQL database for ID: ${nameFilter} today (${todayStr})...`);
        try {
          // 1. Check if ID exists in hr_person
          const [person] = await hosofficePool.query(`
            SELECT CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname
            FROM hr_person
            WHERE FINGLE_ID = ?
            LIMIT 1
          `, [nameFilter]);

          if (person.length === 0) {
            return `ไม่พบรหัสพนักงาน ${nameFilter} ในระบบ`;
          }

          const fullname = person[0].fullname.trim();

          // 2. Check scans in hikvision
          const [scans] = await hosofficePool.query(`
            SELECT AccessTime
            FROM hikvision
            WHERE EmployeeID = ?
              AND AccessDate = ?
              AND AuthenticationResult = 'Success'
            ORDER BY AccessTime ASC
          `, [nameFilter, todayStr]);

          if (scans.length > 0) {
            const times = scans.map(s => `${s.AccessTime} น.`).join(', ');
            return `${fullname} - ${times}`;
          } else {
            return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
          }
        } catch (err) {
          console.error('[Chatbot] Database query error for ID today:', err.message);
          return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
        }
      } else {
        // Individual Query by Name
        console.log(`[Chatbot] Querying SQL database for name filter: ${nameFilter} today (${todayStr})...`);
        try {
          const [scans] = await hosofficePool.query(`
            SELECT 
              COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
              h.AccessTime
            FROM hikvision h
            LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
            WHERE h.AccessDate = ?
              AND h.AuthenticationResult = 'Success'
              AND (p.HR_FNAME LIKE ? OR p.HR_LNAME LIKE ? OR h.PersonName LIKE ?)
            ORDER BY h.AccessTime ASC
          `, [todayStr, `%${nameFilter}%`, `%${nameFilter}%`, `%${nameFilter}%`]);

          if (scans.length > 0) {
            let reply = `📊 *รายการสแกนวันนี้ของ ${nameFilter}*\nพบทั้งหมด ${scans.length} รายการ\n\n`;
            scans.forEach(s => {
              reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
            });
            return reply.trim();
          }
        } catch (err) {
          console.error('[Chatbot] Database query error for name:', err.message);
        }
        return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
      }
    }

    // Global Query
    console.log(`[Chatbot] Querying SQL database for today's scans (${todayStr})...`);
    try {
      const [scans] = await hosofficePool.query(`
        SELECT 
          COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
          h.AccessTime
        FROM hikvision h
        LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
        WHERE h.AccessDate = ?
          AND h.AuthenticationResult = 'Success'
        ORDER BY h.AccessTime ASC
      `, [todayStr]);

      if (scans.length > 0) {
        let reply = `📊 *รายการสแกนสำเร็จวันนี้*\n📅 วันที่: ${todayThai}\nพบทั้งหมด ${scans.length} รายการ\n\n`;
        scans.forEach(s => {
          reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
        });
        return reply.trim();
      }
    } catch (err) {
      console.error('[Chatbot] Database query error:', err.message);
    }

    return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
  }

  /**
   * Handle "สแกน วันที่ [วันที่]" command
   * Queries SQL database for the requested date
   */
  async handleHistoricalScans(day, month, year, empId = null) {
    const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateThai = `${day}/${month}/${year}`;

    try {
      console.log(`[Chatbot] Querying SQL database for historical date: ${formattedDate}...`);
      const [scans] = await hosofficePool.query(`
        SELECT 
          COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
          h.AccessTime
        FROM hikvision h
        LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
        WHERE h.AccessDate = ?
          AND h.AuthenticationResult = 'Success'
          ${empId ? 'AND h.EmployeeID = ?' : ''}
        ORDER BY h.AccessTime ASC
      `, empId ? [formattedDate, empId] : [formattedDate]);

      if (scans.length > 0) {
        let reply = `📊 *รายการสแกนสำเร็จ*\n📅 วันที่: ${dateThai}\nพบทั้งหมด ${scans.length} รายการ\n\n`;
        scans.forEach(s => {
          reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
        });
        return reply.trim();
      }
    } catch (err) {
      console.error('[Chatbot] Database query error:', err.message);
    }

    return 'ขออภัยครับ ไม่พบข้อมูลในวันที่ระบุ กรุณาตรวจสอบรูปแบบวันที่อีกครั้ง';
  }

  /**
   * Handle "ขอดูการสแกนเมื่อวาน" command
   * Queries SQL database for DATE = YESTERDAY (using Asia/Bangkok time)
   * Can optionally filter by EmployeeID or Name
   */
  async handleYesterdayScans(nameFilter = null) {
    const bangkokDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const yesterday = new Date(bangkokDate);
    yesterday.setDate(yesterday.getDate() - 1);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${year}-${month}-${day}`;

    const yesterdayThai = yesterday.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (nameFilter) {
      // Check if it is an EmployeeID query
      const isIdQuery = /^[A-Za-z0-9_\-]+$/.test(nameFilter);

      if (isIdQuery) {
        console.log(`[Chatbot] Querying SQL database for ID: ${nameFilter} yesterday (${yesterdayStr})...`);
        try {
          // 1. Check if ID exists in hr_person
          const [person] = await hosofficePool.query(`
            SELECT CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname
            FROM hr_person
            WHERE FINGLE_ID = ?
            LIMIT 1
          `, [nameFilter]);

          if (person.length === 0) {
            return `ไม่พบรหัสพนักงาน ${nameFilter} ในระบบ`;
          }

          const fullname = person[0].fullname.trim();

          // 2. Check scans in hikvision
          const [scans] = await hosofficePool.query(`
            SELECT AccessTime
            FROM hikvision
            WHERE EmployeeID = ?
              AND AccessDate = ?
              AND AuthenticationResult = 'Success'
            ORDER BY AccessTime ASC
          `, [nameFilter, yesterdayStr]);

          if (scans.length > 0) {
            const times = scans.map(s => `${s.AccessTime} น.`).join(', ');
            return `${fullname} - ${times}`;
          } else {
            return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
          }
        } catch (err) {
          console.error('[Chatbot] Database query error for ID yesterday:', err.message);
          return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
        }
      } else {
        // Individual Query by Name
        console.log(`[Chatbot] Querying SQL database for name filter: ${nameFilter} yesterday (${yesterdayStr})...`);
        try {
          const [scans] = await hosofficePool.query(`
            SELECT 
              COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
              h.AccessTime
            FROM hikvision h
            LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
            WHERE h.AccessDate = ?
              AND h.AuthenticationResult = 'Success'
              AND (p.HR_FNAME LIKE ? OR p.HR_LNAME LIKE ? OR h.PersonName LIKE ?)
            ORDER BY h.AccessTime ASC
          `, [yesterdayStr, `%${nameFilter}%`, `%${nameFilter}%`, `%${nameFilter}%`]);

          if (scans.length > 0) {
            let reply = `📊 *รายการสแกนเมื่อวานของ ${nameFilter}*\nพบทั้งหมด ${scans.length} รายการ\n\n`;
            scans.forEach(s => {
              reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
            });
            return reply.trim();
          }
        } catch (err) {
          console.error('[Chatbot] Database query error for name:', err.message);
        }
        return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
      }
    }

    // Global Query
    console.log(`[Chatbot] Querying SQL database for yesterday's scans (${yesterdayStr})...`);
    try {
      const [scans] = await hosofficePool.query(`
        SELECT 
          COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
          h.AccessTime
        FROM hikvision h
        LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
        WHERE h.AccessDate = ?
          AND h.AuthenticationResult = 'Success'
        ORDER BY h.AccessTime ASC
      `, [yesterdayStr]);

      if (scans.length > 0) {
        let reply = `📊 *รายการสแกนสำเร็จเมื่อวาน*\n📅 วันที่: ${yesterdayThai}\nพบทั้งหมด ${scans.length} รายการ\n\n`;
        scans.forEach(s => {
          reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
        });
        return reply.trim();
      }
    } catch (err) {
      console.error('[Chatbot] Database query error:', err.message);
    }

    return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
  }

  /**
   * Handle "ขอดูย้อนหลัง N วัน" command
   * Queries SQL database for the past N days (including today)
   * Can optionally filter by EmployeeID or Name
   */
  async handleRangeScans(days, nameFilter = null) {
    const dates = [];
    const bangkokDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));

    for (let i = 0; i < days; i++) {
      const d = new Date(bangkokDate);
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }

    const startDateStr = dates[dates.length - 1];
    const endDateStr = dates[0];

    if (nameFilter) {
      const isIdQuery = /^[A-Za-z0-9_\-]+$/.test(nameFilter);
      if (isIdQuery) {
        console.log(`[Chatbot] Querying SQL database for ID: ${nameFilter} past ${days} days...`);
        try {
          // 1. Check if ID exists in hr_person
          const [person] = await hosofficePool.query(`
            SELECT CONCAT(TRIM(HR_FNAME), ' ', TRIM(HR_LNAME)) as fullname
            FROM hr_person
            WHERE FINGLE_ID = ?
            LIMIT 1
          `, [nameFilter]);

          if (person.length === 0) {
            return `ไม่พบรหัสพนักงาน ${nameFilter} ในระบบ`;
          }

          const fullname = person[0].fullname.trim();

          // 2. Query scans from hikvision
          const [scans] = await hosofficePool.query(`
            SELECT AccessDate, AccessTime
            FROM hikvision
            WHERE EmployeeID = ?
              AND AccessDate >= ?
              AND AccessDate <= ?
              AND AuthenticationResult = 'Success'
            ORDER BY AccessDate DESC, AccessTime ASC
          `, [nameFilter, startDateStr, endDateStr]);

          // Build a map of date -> array of times
          const scanMap = {};
          scans.forEach(s => {
            let formattedDate = s.AccessDate;
            if (formattedDate instanceof Date) {
              const y = formattedDate.getFullYear();
              const m = String(formattedDate.getMonth() + 1).padStart(2, '0');
              const d = String(formattedDate.getDate()).padStart(2, '0');
              formattedDate = `${y}-${m}-${d}`;
            } else if (typeof formattedDate === 'string' && formattedDate.includes('T')) {
              formattedDate = formattedDate.split('T')[0];
            }
            if (!scanMap[formattedDate]) {
              scanMap[formattedDate] = [];
            }
            scanMap[formattedDate].push(`${s.AccessTime} น.`);
          });

          if (scans.length > 0) {
            // Build the response
            let reply = `👤 *${fullname}* (ประวัติย้อนหลัง ${days} วัน)\n`;
            dates.forEach(dStr => {
              const parts = dStr.split('-');
              const thaiYear = parseInt(parts[0], 10) + 543;
              const displayDate = `${parts[2]}/${parts[1]}/${thaiYear}`;

              if (scanMap[dStr] && scanMap[dStr].length > 0) {
                reply += `📅 ${displayDate}: ${scanMap[dStr].join(', ')}\n`;
              } else {
                reply += `📅 ${displayDate}: ยังไม่มีรายการสแกน\n`;
              }
            });
            return reply.trim();
          } else {
            return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
          }
        } catch (err) {
          console.error(`[Chatbot] Database query error for ID past ${days} days:`, err.message);
          return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
        }
      } else {
        // Individual query by Name
        console.log(`[Chatbot] Querying SQL database for name filter: ${nameFilter} past ${days} days...`);
        try {
          const [scans] = await hosofficePool.query(`
            SELECT 
              COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
              h.AccessDate,
              h.AccessTime
            FROM hikvision h
            LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
            WHERE h.AccessDate >= ? AND h.AccessDate <= ?
              AND h.AuthenticationResult = 'Success'
              AND (p.HR_FNAME LIKE ? OR p.HR_LNAME LIKE ? OR h.PersonName LIKE ?)
            ORDER BY h.AccessDate DESC, h.AccessTime ASC
          `, [startDateStr, endDateStr, `%${nameFilter}%`, `%${nameFilter}%`, `%${nameFilter}%`]);

          if (scans.length > 0) {
            // Group by Date
            const groupMap = {};
            scans.forEach(s => {
              let formattedDate = s.AccessDate;
              if (formattedDate instanceof Date) {
                const y = formattedDate.getFullYear();
                const m = String(formattedDate.getMonth() + 1).padStart(2, '0');
                const d = String(formattedDate.getDate()).padStart(2, '0');
                formattedDate = `${y}-${m}-${d}`;
              } else if (typeof formattedDate === 'string' && formattedDate.includes('T')) {
                formattedDate = formattedDate.split('T')[0];
              }
              if (!groupMap[formattedDate]) {
                groupMap[formattedDate] = [];
              }
              groupMap[formattedDate].push(s);
            });

            let reply = `📊 *รายการสแกนย้อนหลัง ${days} วันของ ${nameFilter}*\n\n`;
            dates.forEach(dStr => {
              const parts = dStr.split('-');
              const thaiYear = parseInt(parts[0], 10) + 543;
              const displayDate = `${parts[2]}/${parts[1]}/${thaiYear}`;

              const dayScans = groupMap[dStr] || [];
              if (dayScans.length > 0) {
                reply += `📅 วันที่: ${displayDate} (พบ ${dayScans.length} รายการ)\n`;
                dayScans.forEach(s => {
                  reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
                });
                reply += `\n`;
              }
            });
            return reply.trim();
          } else {
            return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
          }
        } catch (err) {
          console.error(`[Chatbot] Database query error for name past ${days} days:`, err.message);
        }
        return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
      }
    }

    // Global Query
    console.log(`[Chatbot] Querying SQL database for global scans past ${days} days...`);
    try {
      const [scans] = await hosofficePool.query(`
        SELECT 
          COALESCE(CONCAT(TRIM(p.HR_FNAME), ' ', TRIM(p.HR_LNAME)), h.PersonName, h.EmployeeID) as fullname,
          h.AccessDate,
          h.AccessTime
        FROM hikvision h
        LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
        WHERE h.AccessDate >= ? AND h.AccessDate <= ?
          AND h.AuthenticationResult = 'Success'
        ORDER BY h.AccessDate DESC, h.AccessTime ASC
      `, [startDateStr, endDateStr]);

      if (scans.length > 0) {
        // Group by Date
        const groupMap = {};
        scans.forEach(s => {
          let formattedDate = s.AccessDate;
          if (formattedDate instanceof Date) {
            const y = formattedDate.getFullYear();
            const m = String(formattedDate.getMonth() + 1).padStart(2, '0');
            const d = String(formattedDate.getDate()).padStart(2, '0');
            formattedDate = `${y}-${m}-${d}`;
          } else if (typeof formattedDate === 'string' && formattedDate.includes('T')) {
            formattedDate = formattedDate.split('T')[0];
          }
          if (!groupMap[formattedDate]) {
            groupMap[formattedDate] = [];
          }
          groupMap[formattedDate].push(s);
        });

        let reply = `📊 *รายการสแกนสำเร็จย้อนหลัง ${days} วัน*\n\n`;
        dates.forEach(dStr => {
          const parts = dStr.split('-');
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          const dObj = new Date(year, month, day);
          const thaiDate = dObj.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          const dayScans = groupMap[dStr] || [];
          if (dayScans.length > 0) {
            reply += `📅 วันที่: ${thaiDate} (พบ ${dayScans.length} รายการ)\n`;
            dayScans.forEach(s => {
              reply += `👤 ${s.fullname.trim()} - ⏰ ${s.AccessTime} น.\n`;
            });
            reply += `\n`;
          }
        });
        return reply.trim();
      } else {
        return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
      }
    } catch (err) {
      console.error(`[Chatbot] Database query error for global past ${days} days:`, err.message);
    }
    return 'ไม่พบข้อมูลการสแกนในช่วงเวลาที่ระบุ';
  }
}

module.exports = new ChatbotService();
