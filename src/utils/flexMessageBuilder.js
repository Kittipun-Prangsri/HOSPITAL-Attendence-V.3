/**
 * Utility to build modern, highly polished LINE Flex Messages for Hospital Attendance
 */

function getStatusTheme(direction, isLate, authResult) {
  if (authResult === 'Failed') {
    return {
      headerBg: '#881337', // Rose Deep
      statusBg: '#ffe4e6',
      statusColor: '#9f1239',
      statusLabel: '❌ สแกนไม่ผ่าน',
      bannerTitle: 'ATTENDANCE FAILED',
      badgeText: 'FAILED'
    };
  }

  const dir = (direction || '').toLowerCase();

  if (dir === 'out' || dir === 'o' || dir === 'check-out') {
    return {
      headerBg: '#1e1b4b', // Deep Slate Indigo
      statusBg: '#e0e7ff',
      statusColor: '#3730a3',
      statusLabel: '📤 ออกงาน (Check-out)',
      bannerTitle: 'CHECK-OUT LOGGED',
      badgeText: 'OUT'
    };
  }

  if (isLate) {
    return {
      headerBg: '#78350f', // Deep Warm Amber
      statusBg: '#fef3c7',
      statusColor: '#92400e',
      statusLabel: '⏰ เข้างานสาย (Late)',
      bannerTitle: 'CHECK-IN (LATE)',
      badgeText: 'LATE'
    };
  }

  // Check-in On-time
  return {
    headerBg: '#064e3b', // Deep Emerald Teal
    statusBg: '#d1fae5',
    statusColor: '#065f46',
    statusLabel: '✅ เข้างานปกติ (Check-in)',
    bannerTitle: 'CHECK-IN LOGGED',
    badgeText: 'ON TIME'
  };
}

/**
 * Builds a modern, premium LINE Flex Message Bubble JSON object
 */
function createAttendanceFlex({
  fullname = 'พนักงาน',
  employeeId = '',
  statusLabel = '',
  direction = 'in',
  isLate = false,
  authResult = 'Success',
  timeStr = '--:--',
  dateStr = '',
  deviceName = 'ไม่ระบุจุดสแกน',
  temperature = null,
  historyUrl = null,
  excuseUrl = null
}) {
  const theme = getStatusTheme(direction, isLate, authResult);
  const displayStatus = statusLabel || theme.statusLabel;

  const infoRows = [
    {
      type: "box",
      layout: "baseline",
      contents: [
        {
          type: "text",
          text: "📅 วันที่",
          color: "#64748b",
          size: "xs",
          flex: 2
        },
        {
          type: "text",
          text: dateStr || 'วันนี้',
          color: "#1e293b",
          size: "xs",
          weight: "bold",
          flex: 5,
          align: "end"
        }
      ]
    },
    {
      type: "box",
      layout: "baseline",
      contents: [
        {
          type: "text",
          text: "🚪 จุดบันทึก",
          color: "#64748b",
          size: "xs",
          flex: 2
        },
        {
          type: "text",
          text: deviceName,
          color: "#1e293b",
          size: "xs",
          weight: "bold",
          flex: 5,
          align: "end"
        }
      ]
    }
  ];

  if (temperature && String(temperature).trim() !== '') {
    infoRows.push({
      type: "box",
      layout: "baseline",
      contents: [
        {
          type: "text",
          text: "🌡️ อุณหภูมิ",
          color: "#64748b",
          size: "xs",
          flex: 2
        },
        {
          type: "text",
          text: `${temperature} °C`,
          color: "#1e293b",
          size: "xs",
          weight: "bold",
          flex: 5,
          align: "end"
        }
      ]
    });
  }

  const baseUrl = (process.env.SYSTEM_URL || process.env.DOMAIN || '').trim();
  const hasValidUrl = baseUrl && baseUrl.startsWith('http');

  const defaultHistoryUrl = historyUrl || (hasValidUrl ? `${baseUrl}/attendance` : null);
  const defaultExcuseUrl = excuseUrl || (hasValidUrl ? `${baseUrl}/excuses` : null);

  const historyBtnAction = defaultHistoryUrl
    ? { type: "uri", label: "ดูประวัติ", uri: defaultHistoryUrl }
    : { type: "postback", label: "ดูประวัติการเข้างาน", data: "action=today_history", displayText: "ดูประวัติการเข้างาน" };

  const excuseBtnAction = defaultExcuseUrl
    ? { type: "uri", label: "ส่งใบแก้ต่าง", uri: defaultExcuseUrl }
    : { type: "postback", label: "ยื่นใบลา / แจ้งเหตุสาย", data: "action=excuse", displayText: "ยื่นใบลา / แจ้งเหตุสาย" };

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
            {
              type: "text",
              text: "🏥 KHH ATTENDANCE",
              color: "#ffffff",
              size: "xxs",
              weight: "bold",
              flex: 1
            },
            {
              type: "text",
              text: theme.badgeText,
              color: "#ffffff",
              size: "xxs",
              weight: "bold",
              align: "end"
            }
          ]
        },
        {
          type: "text",
          text: theme.bannerTitle,
          color: "#ffffff",
          size: "lg",
          weight: "bold",
          margin: "sm"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        // Name Block
        {
          type: "text",
          text: fullname,
          weight: "bold",
          size: "xl",
          color: "#0f172a",
          wrap: true
        },
        ...(employeeId ? [{
          type: "text",
          text: `รหัสพนักงาน: ${employeeId}`,
          size: "xs",
          color: "#64748b",
          margin: "xs"
        }] : []),

        // Status Pill
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
                {
                  type: "text",
                  text: displayStatus,
                  color: theme.statusColor,
                  size: "xs",
                  weight: "bold",
                  align: "center"
                }
              ]
            }
          ]
        },

        // Divider
        {
          type: "separator",
          margin: "lg",
          color: "#f1f5f9"
        },

        // Main Highlight Time Box
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          backgroundColor: "#f8fafc",
          cornerRadius: "12px",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "เวลาบันทึก",
              size: "xxs",
              color: "#64748b",
              align: "center"
            },
            {
              type: "text",
              text: `${timeStr} น.`,
              size: "xxl",
              weight: "bold",
              color: "#0f172a",
              align: "center",
              margin: "xs"
            }
          ]
        },

        // Detailed Grid
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "md",
          contents: infoRows
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
          action: historyBtnAction,
          style: "primary",
          color: theme.headerBg,
          height: "sm"
        },
        ...(isLate ? [{
          type: "button",
          action: excuseBtnAction,
          style: "secondary",
          height: "sm"
        }] : [])
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
function createWeeklySummaryFlex({
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
          action: { type: "uri", label: "ดูประวัติ", uri: defaultHistoryUrl },
          style: "primary",
          color: theme.headerBg,
          height: "sm"
        }
      ]
    }
  };
}

module.exports = {
  createAttendanceFlex,
  createWeeklySummaryFlex,
  getStatusTheme,
  getWeeklySummaryTheme
};
