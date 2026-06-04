const { hosofficePool } = require('../config/db');

class ChatbotService {
  /**
   * Main entry point to handle incoming text messages
   */
  async handleMessage(text, userId) {
    if (!text) return null;
    const cleanText = text.trim();

    // Command: "ขอรหัสemployeeid"
    if (cleanText.toLowerCase() === 'ขอรหัสemployeeid') {
      console.log(`[Chatbot] Looking up EmployeeID for platform ID: ${userId}...`);
      try {
        const [rows] = await hosofficePool.query(`
          SELECT FINGLE_ID 
          FROM hr_person 
          WHERE LINE_TOKEN = ? 
             OR LINE_TOKEN1 = ? 
             OR LINE_TOKEN2 = ? 
             OR LINE_YOUR_USER_ID = ?
             OR TELEGRAM_CHAT_ID = ?
          LIMIT 1
        `, [userId, userId, userId, userId, userId]);

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

    // 1. Command: "ขอดูการสแกนวันนี้ [EmployeeID/Name]" (supports ขอดูการสแกนวันนี้, ขอดูแสกนวันนี้, เลข 1, หรือ scan_today)
    const todayRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)วันนี้|1|scan_today)(?:\s+(.+))?$/i;
    const todayMatch = cleanText.match(todayRegex);
    if (todayMatch) {
      const nameFilter = todayMatch[1] ? todayMatch[1].trim() : null;
      return await this.handleTodayScans(nameFilter);
    }

    // 1b. Command: "ขอดูการสแกนเมื่อวาน [EmployeeID/Name]" (supports ขอดูการสแกนเมื่อวาน, ขอดูย้อนหลังเมื่อวาน, เลข 2, หรือ scan_yesterday)
    const yesterdayRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)เมื่อวาน|ขอดูย้อนหลังเมื่อวาน|2|scan_yesterday)(?:\s+(.+))?$/i;
    const yesterdayMatch = cleanText.match(yesterdayRegex);
    if (yesterdayMatch) {
      const nameFilter = yesterdayMatch[1] ? yesterdayMatch[1].trim() : null;
      return await this.handleYesterdayScans(nameFilter);
    }

    // 1c. Command: "ขอดูย้อนหลัง 3 วัน [EmployeeID/Name]" (supports เลข 3 หรือ scan_3days)
    const threeDaysRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)ย้อนหลัง\s*3\s*วัน|3|scan_3days)(?:\s+(.+))?$/i;
    const threeDaysMatch = cleanText.match(threeDaysRegex);
    if (threeDaysMatch) {
      const nameFilter = threeDaysMatch[1] ? threeDaysMatch[1].trim() : null;
      return await this.handleRangeScans(3, nameFilter);
    }

    // 1d. Command: "ขอดูย้อนหลัง 7 วัน [EmployeeID/Name]" (supports เลข 7 หรือ scan_7days)
    const sevenDaysRegex = /^(?:ขอดู(?:การ)?(?:สแกน|แสกน)ย้อนหลัง\s*7\s*วัน|7|scan_7days)(?:\s+(.+))?$/i;
    const sevenDaysMatch = cleanText.match(sevenDaysRegex);
    if (sevenDaysMatch) {
      const nameFilter = sevenDaysMatch[1] ? sevenDaysMatch[1].trim() : null;
      return await this.handleRangeScans(7, nameFilter);
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
        return await this.handleHistoricalScans(day, month + 1, adYear);
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
  async handleTodayScans(nameFilter = null) {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const todayThai = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (nameFilter) {
      // Check if it is an EmployeeID query (contains only alphanumeric characters, no Thai characters)
      const isIdQuery = /^[A-Za-z0-9_\-]+$/.test(nameFilter);

      if (isIdQuery) {
        console.log(`[Chatbot] Querying SQL database for ID: ${nameFilter} today (${todayStr})...`);
        try {
          // 1. Check if ID exists in hr_person
          const [person] = await hosofficePool.query(`
            SELECT CONCAT(HR_FNAME, '   ', HR_LNAME) as fullname
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
              COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
          COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
  async handleHistoricalScans(day, month, year) {
    const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateThai = `${day}/${month}/${year}`;

    try {
      console.log(`[Chatbot] Querying SQL database for historical date: ${formattedDate}...`);
      const [scans] = await hosofficePool.query(`
        SELECT 
          COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
          h.AccessTime
        FROM hikvision h
        LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
        WHERE h.AccessDate = ?
          AND h.AuthenticationResult = 'Success'
        ORDER BY h.AccessTime ASC
      `, [formattedDate]);

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
            SELECT CONCAT(HR_FNAME, '   ', HR_LNAME) as fullname
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
              COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
          COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
            SELECT CONCAT(HR_FNAME, '   ', HR_LNAME) as fullname
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
              COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
          COALESCE(CONCAT(p.HR_FNAME, '   ', p.HR_LNAME), h.PersonName, h.EmployeeID) as fullname,
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
