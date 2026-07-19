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
