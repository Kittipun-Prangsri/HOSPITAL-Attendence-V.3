/**
 * LINE Flex Message Generator for Klong Hat Hospital Attendance System
 * Generates beautiful, modern, hospital-branded Flex Message bubbles.
 */

function determineStatusType(direction, attendanceStatus, authResult, isLate) {
  if (authResult === 'Failed' || authResult === 'FAILED' || authResult === 'Denied') {
    return 'failed';
  }
  if (isLate) {
    return 'late';
  }
  const status = (attendanceStatus || direction || '').toLowerCase();
  if (status === 'i' || status === 'in' || status === 'check-in') {
    return 'check-in';
  }
  if (status === 'o' || status === 'out' || status === 'check-out') {
    return 'check-out';
  }
  return 'check-in';
}

/**
 * Builds a high-aesthetic LINE Flex Message bubble for attendance logs.
 */
function buildAttendanceFlex(params = {}) {
  const {
    fullname = 'ไม่ระบุชื่อ',
    employeeId = '',
    direction = 'in',
    attendanceStatus = 'i',
    authResult = 'Success',
    dateThai = '',
    timeStr = '',
    deviceName = 'ไม่ระบุจุดบันทึก',
    temperature = null,
    isLate = false,
    systemUrl = (process.env.SYSTEM_URL || process.env.DOMAIN || '').trim()
  } = params;

  const statusType = determineStatusType(direction, attendanceStatus, authResult, isLate);

  // Styling maps based on statusType
  const themeMap = {
    'check-in': {
      headerBg: '#0D9488', // Emerald Teal
      subHeaderColor: '#CCFBF1',
      badgeBg: '#ECFDF5',
      badgeBorder: '#A7F3D0',
      badgeTextColor: '#047857',
      badgeIcon: '✅',
      statusTitle: 'สแกนเข้างาน (Check-In)',
      headerTag: 'ENTER • เข้างาน',
      btnColor: '#0D9488'
    },
    'check-out': {
      headerBg: '#0284C7', // Royal Blue
      subHeaderColor: '#E0F2FE',
      badgeBg: '#F0F9FF',
      badgeBorder: '#BAE6FD',
      badgeTextColor: '#0369A1',
      badgeIcon: '📤',
      statusTitle: 'สแกนออกงาน (Check-Out)',
      headerTag: 'EXIT • ออกงาน',
      btnColor: '#0284C7'
    },
    'late': {
      headerBg: '#D97706', // Amber Gold
      subHeaderColor: '#FEF3C7',
      badgeBg: '#FFFBEB',
      badgeBorder: '#FDE68A',
      badgeTextColor: '#B45309',
      badgeIcon: '⏰',
      statusTitle: 'เข้างานสาย (Late Arrival)',
      headerTag: 'LATE • เข้างานสาย',
      btnColor: '#D97706'
    },
    'failed': {
      headerBg: '#E11D48', // Rose Red
      subHeaderColor: '#FFE4E6',
      badgeBg: '#FEF2F2',
      badgeBorder: '#FECDD3',
      badgeTextColor: '#BE123C',
      badgeIcon: '❌',
      statusTitle: 'สแกนไม่ผ่าน (Scan Failed)',
      headerTag: 'FAILED • ไม่ผ่าน',
      btnColor: '#E11D48'
    }
  };

  const theme = themeMap[statusType] || themeMap['check-in'];
  const firstLetter = fullname ? fullname.trim().charAt(0).toUpperCase() : 'U';

  const detailRows = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '📅 วันที่',
          size: 'xs',
          color: '#64748B',
          flex: 2
        },
        {
          type: 'text',
          text: dateThai || 'วันนี้',
          size: 'xs',
          color: '#1E293B',
          weight: 'bold',
          flex: 4,
          align: 'end'
        }
      ]
    },
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '⏰ เวลาบันทึก',
          size: 'xs',
          color: '#64748B',
          flex: 2
        },
        {
          type: 'text',
          text: timeStr ? `${timeStr} น.` : '-',
          size: 'xs',
          color: '#1E293B',
          weight: 'bold',
          flex: 4,
          align: 'end'
        }
      ]
    },
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '🚪 จุดบันทึก',
          size: 'xs',
          color: '#64748B',
          flex: 2
        },
        {
          type: 'text',
          text: deviceName || 'ไม่ระบุ',
          size: 'xs',
          color: '#1E293B',
          weight: 'bold',
          flex: 4,
          align: 'end',
          wrap: true
        }
      ]
    }
  ];

  if (temperature && String(temperature).trim() !== '') {
    detailRows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '🌡️ อุณหภูมิ',
          size: 'xs',
          color: '#64748B',
          flex: 2
        },
        {
          type: 'text',
          text: `${temperature} °C`,
          size: 'xs',
          color: '#1E293B',
          weight: 'bold',
          flex: 4,
          align: 'end'
        }
      ]
    });
  }

  const historyAction = {
    type: 'postback',
    label: '📋 ดูประวัติการเข้างาน',
    data: 'action=today_history',
    displayText: 'ดูประวัติการเข้างาน'
  };

  const excuseAction = {
    type: 'postback',
    label: '📝 ยื่นใบลา / แจ้งเหตุสาย',
    data: 'action=excuse',
    displayText: 'ยื่นใบลา / แจ้งเหตุสาย'
  };

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.headerBg,
      paddingTop: '20px',
      paddingBottom: '20px',
      paddingStart: '20px',
      paddingEnd: '20px',
      contents: [
        {
          type: 'text',
          text: 'KLONG HAT HOSPITAL • ATTENDANCE LOG',
          color: theme.subHeaderColor,
          size: 'xxs',
          weight: 'bold',
          align: 'center'
        },
        {
          type: 'text',
          text: 'บันทึกเวลาปฏิบัติงาน',
          color: '#FFFFFF',
          size: 'xl',
          weight: 'bold',
          margin: 'xs',
          align: 'center'
        },
        {
          type: 'text',
          text: `[ ${theme.headerTag} ]`,
          color: theme.subHeaderColor,
          size: 'xs',
          margin: 'xs',
          align: 'center'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        // Employee Profile Box
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          alignItems: 'center',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '46px',
              height: '46px',
              cornerRadius: '23px',
              backgroundColor: theme.headerBg,
              alignItems: 'center',
              justifyContent: 'center',
              contents: [
                {
                  type: 'text',
                  text: firstLetter,
                  color: '#FFFFFF',
                  size: 'lg',
                  weight: 'bold',
                  align: 'center'
                }
              ]
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              contents: [
                {
                  type: 'text',
                  text: fullname,
                  weight: 'bold',
                  size: 'md',
                  color: '#0F172A',
                  wrap: true
                },
                {
                  type: 'text',
                  text: employeeId ? `ID: ${employeeId}` : 'บุคลากรโรงพยาบาล',
                  size: 'xs',
                  color: '#64748B',
                  margin: 'xs'
                }
              ]
            }
          ]
        },

        {
          type: 'separator',
          margin: 'lg',
          color: '#E2E8F0'
        },

        // Status Card Box
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          backgroundColor: theme.badgeBg,
          borderColor: theme.badgeBorder,
          borderWidth: '1px',
          cornerRadius: '12px',
          paddingAll: '14px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              alignItems: 'center',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: theme.badgeIcon,
                  size: 'md'
                },
                {
                  type: 'text',
                  text: theme.statusTitle,
                  color: theme.badgeTextColor,
                  weight: 'bold',
                  size: 'sm'
                }
              ]
            }
          ]
        },

        // Details Container
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          backgroundColor: '#F8FAFC',
          cornerRadius: '12px',
          paddingAll: '14px',
          contents: detailRows
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        {
          type: 'button',
          action: historyAction,
          style: 'primary',
          color: theme.btnColor,
          height: 'sm'
        },
        {
          type: 'button',
          action: excuseAction,
          style: 'secondary',
          color: theme.btnColor,
          height: 'sm'
        }
      ]
    }
  };
}

/**
 * Builds a LINE Flex Message bubble summarizing a user's attendance history for today
 */
function buildHistoryFlex(params = {}) {
  const {
    fullname = 'บุคลากรโรงพยาบาล',
    employeeId = '',
    dateThai = '',
    scans = []
  } = params;

  const firstLetter = fullname ? fullname.trim().charAt(0).toUpperCase() : 'K';
  const hasScans = scans && scans.length > 0;

  const scanRows = hasScans ? scans.map((s, idx) => {
    return {
      type: 'box',
      layout: 'horizontal',
      justifyContent: 'space-between',
      alignItems: 'center',
      margin: idx > 0 ? 'sm' : 'none',
      contents: [
        {
          type: 'text',
          text: `${idx + 1}. ⏰ ${s.AccessTime || s.timeStr} น.`,
          size: 'xs',
          weight: 'bold',
          color: '#0F172A',
          flex: 6
        },
        {
          type: 'text',
          text: `🚪 ${s.DeviceName || s.deviceName || 'ประตูสแกน'}`,
          size: 'xs',
          color: '#64748B',
          align: 'end',
          flex: 6
        }
      ]
    };
  }) : [
    {
      type: 'text',
      text: '⚠️ ยังไม่พบรายการสแกนเข้า-ออกงานในระบบสำหรับวันนี้',
      size: 'xs',
      color: '#94A3B8',
      align: 'center'
    }
  ];

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0D9488',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: 'KLONG HAT HOSPITAL • ATTENDANCE LOG',
          color: '#CCFBF1',
          size: 'xxs',
          weight: 'bold',
          align: 'center'
        },
        {
          type: 'text',
          text: 'ประวัติการบันทึกเวลาประจำวัน',
          color: '#FFFFFF',
          size: 'lg',
          weight: 'bold',
          margin: 'xs',
          align: 'center'
        },
        {
          type: 'text',
          text: `📅 ${dateThai}`,
          color: '#CCFBF1',
          size: 'xs',
          margin: 'xs',
          align: 'center'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        // User Profile
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          alignItems: 'center',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '42px',
              height: '42px',
              cornerRadius: '21px',
              backgroundColor: '#0D9488',
              alignItems: 'center',
              justifyContent: 'center',
              contents: [
                {
                  type: 'text',
                  text: firstLetter,
                  color: '#FFFFFF',
                  size: 'md',
                  weight: 'bold',
                  align: 'center'
                }
              ]
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              contents: [
                {
                  type: 'text',
                  text: fullname,
                  weight: 'bold',
                  size: 'md',
                  color: '#0F172A',
                  wrap: true
                },
                {
                  type: 'text',
                  text: employeeId ? `รหัสพนักงาน: ${employeeId}` : 'บุคลากรโรงพยาบาลคลองหาด',
                  size: 'xs',
                  color: '#64748B',
                  margin: 'xs'
                }
              ]
            }
          ]
        },

        {
          type: 'separator',
          margin: 'lg',
          color: '#E2E8F0'
        },

        // Status Card
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          backgroundColor: '#ECFDF5',
          borderColor: '#A7F3D0',
          borderWidth: '1px',
          cornerRadius: '12px',
          paddingAll: '12px',
          contents: [
            {
              type: 'text',
              text: `📊 สรุปรายการสแกนวันนี้ (พบ ${scans.length} รายการ)`,
              color: '#047857',
              weight: 'bold',
              size: 'xs',
              align: 'center'
            }
          ]
        },

        // Scan List Box
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          backgroundColor: '#F8FAFC',
          cornerRadius: '12px',
          paddingAll: '14px',
          contents: scanRows
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        {
          type: 'button',
          action: {
            type: 'postback',
            label: '📝 ยื่นใบลา / แจ้งเหตุสาย',
            data: 'action=excuse',
            displayText: 'ยื่นใบลา / แจ้งเหตุสาย'
          },
          style: 'secondary',
          height: 'sm'
        }
      ]
    }
  };
}

/**
 * Builds a LINE Flex Message bubble for leave and excuse submissions
 */
function buildExcuseFlex(params = {}) {
  const {
    fullname = 'บุคลากรโรงพยาบาล',
    employeeId = ''
  } = params;

  const baseUrl = (process.env.SYSTEM_URL || process.env.DOMAIN || '').trim();
  const hasValidUrl = baseUrl && baseUrl.startsWith('http') && !baseUrl.includes('your-hospital-system.com') && !baseUrl.includes('khh-attendance.com');
  const excuseUrl = hasValidUrl ? `${baseUrl}/excuses` : null;

  const mainAction = excuseUrl
    ? { type: 'uri', label: '🔗 เปิดระบบยื่นใบลาออนไลน์', uri: excuseUrl }
    : { type: 'postback', label: '📋 ดูประวัติการเข้างาน', data: 'action=today_history', displayText: 'ดูประวัติการเข้างาน' };

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0284C7',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: 'KLONG HAT HOSPITAL • HR PORTAL',
          color: '#BAE6FD',
          size: 'xxs',
          weight: 'bold',
          align: 'center'
        },
        {
          type: 'text',
          text: 'ระบบแจ้งสาเหตุ & ยื่นใบลา',
          color: '#FFFFFF',
          size: 'lg',
          weight: 'bold',
          margin: 'xs',
          align: 'center'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: `สวัสดีคุณ ${fullname}`,
          weight: 'bold',
          size: 'md',
          color: '#0F172A'
        },
        {
          type: 'text',
          text: employeeId ? `รหัสพนักงาน: ${employeeId}` : 'บุคลากรโรงพยาบาลคลองหาด',
          size: 'xs',
          color: '#64748B',
          margin: 'xs'
        },

        {
          type: 'separator',
          margin: 'lg',
          color: '#E2E8F0'
        },

        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          backgroundColor: '#F0F9FF',
          borderColor: '#BAE6FD',
          borderWidth: '1px',
          cornerRadius: '12px',
          paddingAll: '14px',
          contents: [
            {
              type: 'text',
              text: '📝 แจ้งเหตุผลเข้างานสาย / ลืมสแกน / ยื่นใบลา',
              color: '#0369A1',
              weight: 'bold',
              size: 'xs'
            },
            {
              type: 'text',
              text: 'หากท่านมีเหตุจำเป็นในการเข้างานสาย ลืมบันทึกเวลา หรือต้องการยื่นใบลาป่วย/ลากิจ สามารถบันทึกข้อมูลผ่านระบบหรือติดต่อ HR โรงพยาบาลได้ครับ',
              size: 'xs',
              color: '#334155',
              wrap: true,
              margin: 'sm'
            }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        {
          type: 'button',
          action: mainAction,
          style: 'primary',
          color: '#0284C7',
          height: 'sm'
        }
      ]
    }
  };
}

function getWeeklySummaryTheme(lateCount, absentCount) {
  if (absentCount > 0 || lateCount > 3) {
    return {
      headerBg: '#881337',
      statusBg: '#ffe4e6',
      statusColor: '#9f1239',
      statusLabel: '⚠️ ต้องปรับปรุง',
      bannerTitle: 'WEEKLY SUMMARY',
      badgeText: 'NEEDS IMPROVEMENT'
    };
  }
  if (lateCount > 0) {
    return {
      headerBg: '#78350f',
      statusBg: '#fef3c7',
      statusColor: '#92400e',
      statusLabel: '⏰ มาสายบ้าง',
      bannerTitle: 'WEEKLY SUMMARY',
      badgeText: 'ATTENTION'
    };
  }
  return {
    headerBg: '#064e3b',
    statusBg: '#d1fae5',
    statusColor: '#065f46',
    statusLabel: '✅ ทำงานดีเยี่ยม',
    bannerTitle: 'WEEKLY SUMMARY',
    badgeText: 'EXCELLENT'
  };
}

/**
 * Builds a per-person LINE Flex Message summarizing one week of attendance
 */
function buildWeeklySummaryFlex({
  fullname = 'พนักงาน',
  employeeId = '',
  weekRangeStr = '',
  daysPresent = 0,
  lateCount = 0,
  absentCount = 0,
  leaveCount = 0,
  totalHours = 0,
  historyUrl = null
}) {
  const theme = getWeeklySummaryTheme(lateCount, absentCount);
  const systemUrl = process.env.SYSTEM_URL || 'https://your-hospital-system.com';
  const defaultHistoryUrl = historyUrl || `${systemUrl}/attendance`;

  const statRow = (label, value, color) => ({
    type: "box",
    layout: "vertical",
    flex: 1,
    contents: [
      { type: "text", text: String(value), size: "xl", weight: "bold", align: "center", color: color || "#0f172a" },
      { type: "text", text: label, size: "xxs", align: "center", color: "#64748b", margin: "xs" }
    ]
  });

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: theme.headerBg,
      paddingAll: "20px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "🏥 KHH ATTENDANCE", color: "#ffffff", size: "xxs", weight: "bold", flex: 1 },
            { type: "text", text: theme.badgeText, color: "#ffffff", size: "xxs", weight: "bold", align: "end" }
          ]
        },
        { type: "text", text: theme.bannerTitle, color: "#ffffff", size: "lg", weight: "bold", margin: "sm" }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        { type: "text", text: fullname, weight: "bold", size: "xl", color: "#0f172a", wrap: true },
        ...(employeeId ? [{ type: "text", text: `รหัสพนักงาน: ${employeeId}`, size: "xs", color: "#64748b", margin: "xs" }] : []),
        { type: "text", text: weekRangeStr, size: "xs", color: "#64748b", margin: "xs" },

        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "box",
              layout: "vertical",
              backgroundColor: theme.statusBg,
              cornerRadius: "20px",
              paddingStart: "12px",
              paddingEnd: "12px",
              paddingTop: "6px",
              paddingBottom: "6px",
              contents: [
                { type: "text", text: theme.statusLabel, color: theme.statusColor, size: "xs", weight: "bold", align: "center" }
              ]
            }
          ]
        },

        { type: "separator", margin: "lg", color: "#f1f5f9" },

        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          backgroundColor: "#f8fafc",
          cornerRadius: "12px",
          paddingAll: "14px",
          contents: [
            { type: "text", text: "ชั่วโมงทำงานรวม", size: "xxs", color: "#64748b", align: "center" },
            { type: "text", text: `${totalHours} ชม.`, size: "xxl", weight: "bold", color: "#0f172a", align: "center", margin: "xs" }
          ]
        },

        {
          type: "box",
          layout: "horizontal",
          margin: "lg",
          spacing: "sm",
          contents: [
            statRow("มาทำงาน (วัน)", daysPresent, "#065f46"),
            statRow("มาสาย (ครั้ง)", lateCount, lateCount > 0 ? "#92400e" : "#0f172a"),
            statRow("ขาดงาน (วัน)", absentCount, absentCount > 0 ? "#9f1239" : "#0f172a"),
            statRow("ลา (วัน)", leaveCount, "#0f172a")
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        {
          type: "button",
          action: {
            type: "postback",
            label: "📋 ดูประวัติการเข้างาน",
            data: "action=today_history",
            displayText: "ดูประวัติการเข้างาน"
          },
          style: "primary",
          color: theme.headerBg,
          height: "sm"
        }
      ]
    }
  };
}

module.exports = {
  buildAttendanceFlex,
  buildHistoryFlex,
  buildExcuseFlex,
  buildWeeklySummaryFlex,
  determineStatusType,
  getWeeklySummaryTheme
};
