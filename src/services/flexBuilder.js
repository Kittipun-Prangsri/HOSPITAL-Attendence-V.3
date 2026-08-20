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
    systemUrl = process.env.SYSTEM_URL || 'https://khh-attendance.com'
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

  const baseUrl = (systemUrl || process.env.DOMAIN || '').trim();
  const hasValidUrl = baseUrl && baseUrl.startsWith('http');

  const historyAction = hasValidUrl
    ? { type: 'uri', label: '📋 ดูประวัติการเข้างาน', uri: `${baseUrl}/schedule` }
    : { type: 'message', label: '📋 ดูประวัติวันนี้', text: 'ขอดูการสแกนวันนี้' };

  const excuseAction = hasValidUrl
    ? { type: 'uri', label: '📝 ยื่นใบลา / แจ้งเหตุสาย', uri: `${baseUrl}/excuses` }
    : { type: 'message', label: '📝 ยื่นใบลา / แจ้งเหตุสาย', text: 'ยื่นใบลา' };

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

module.exports = {
  buildAttendanceFlex,
  determineStatusType
};
