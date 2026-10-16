// Leave types and yearly quotas (days). Defaults follow the Thai civil-service leave
// regulation; adjust here if the hospital uses different entitlements per staff type.
// countCalendarDays: true → weekends are counted (e.g. maternity), false → working days only.
const LEAVE_TYPES = {
  sick: { label: 'ลาป่วย', quota: 60, countCalendarDays: false },
  personal: { label: 'ลากิจส่วนตัว', quota: 45, countCalendarDays: false },
  vacation: { label: 'ลาพักผ่อน', quota: 10, countCalendarDays: false },
  maternity: { label: 'ลาคลอดบุตร', quota: 90, countCalendarDays: true },
  ordination: { label: 'ลาอุปสมบท / ประกอบพิธีฮัจย์', quota: 120, countCalendarDays: true },
  other: { label: 'ลาอื่น ๆ', quota: null, countCalendarDays: false }
};

// Thai government fiscal year starts 1 October
const FISCAL_YEAR_START_MONTH = 10;

const MAX_LEAVE_SPAN_DAYS = 180;

// Default policy, overridable per hospital in Settings → วันหยุดและนโยบายการลา
// attachmentSickDays: sick leave of this many days or more needs a medical certificate (0 = never required)
const DEFAULT_LEAVE_POLICY = { attachmentSickDays: 3, byStatus: {} };

const ATTACHMENT_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

module.exports = { LEAVE_TYPES, FISCAL_YEAR_START_MONTH, MAX_LEAVE_SPAN_DAYS, DEFAULT_LEAVE_POLICY, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES };
