const test = require('node:test');
const assert = require('node:assert/strict');
const { getTimeInTimezone, isLateCheckIn } = require('../src/utils/attendanceTime');

test('late check-in starts after the configured threshold', () => {
  assert.equal(isLateCheckIn('08:31:00'), false);
  assert.equal(isLateCheckIn('08:31:01'), true);
  assert.equal(isLateCheckIn('07:59:59'), false);
});

test('Bangkok time is derived from an absolute timestamp', () => {
  assert.equal(getTimeInTimezone(new Date('2026-01-01T00:00:00.000Z'), 'Asia/Bangkok'), '07:00:00');
});

test('late threshold follows work start + grace minutes', () => {
  const { lateThresholdFor } = require('../src/utils/attendanceTime');
  assert.equal(lateThresholdFor({ workStart: '08:00', lateMin: 31 }), '08:31:00');
  assert.equal(lateThresholdFor({ workStart: '07:30', lateMin: 15 }), '07:45:00');
  assert.equal(lateThresholdFor({ workStart: 'bad', lateMin: 'x' }), '08:31:00');
  assert.equal(lateThresholdFor(), '08:31:00');
});

test('isLateAt uses one rule for HH:MM and HH:MM:SS scans', () => {
  const { isLateAt, normalizeClock } = require('../src/utils/attendanceTime');
  const s = { workStart: '08:00', lateMin: 31 };
  assert.equal(isLateAt('08:31', s), false);
  assert.equal(isLateAt('08:31:00', s), false);
  assert.equal(isLateAt('08:31:01', s), true);
  assert.equal(isLateAt('8:45', s), true);
  assert.equal(isLateAt('ลาป่วย', s), false);
  assert.equal(normalizeClock('7:05'), '07:05:00');
  assert.equal(normalizeClock('25:00'), null);
});

test('toDateKey formats DATE values in the app timezone regardless of host TZ', () => {
  const { toDateKey } = require('../src/utils/attendanceTime');
  // What mysql2 returns for DATE '2026-09-16' with timezone +07:00
  const fromDb = new Date('2026-09-16T00:00:00+07:00');
  assert.equal(toDateKey(fromDb, 'Asia/Bangkok'), '2026-09-16');
  assert.notEqual(fromDb.toISOString().slice(0, 10), '2026-09-16'); // the old bug
  assert.equal(toDateKey('2026-09-16T00:00:00.000Z'), '2026-09-16');
  assert.equal(toDateKey(null), null);
});
