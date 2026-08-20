const DEFAULT_TIMEZONE = 'Asia/Bangkok';

function getTimeInTimezone(date = new Date(), timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('hour')}:${value('minute')}:${value('second')}`;
}

function isLateCheckIn(time, threshold = '08:31:00') {
  return /^\d{2}:\d{2}:\d{2}$/.test(time) && /^\d{2}:\d{2}:\d{2}$/.test(threshold) && time > threshold;
}

module.exports = { getTimeInTimezone, isLateCheckIn };
