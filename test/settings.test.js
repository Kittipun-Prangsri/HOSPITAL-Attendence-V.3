const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSettings } = require('../src/controllers/settingsController');

const valid = () => ({
  workStart: '08:00', workEnd: '16:00', lateMin: 31,
  workDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'mon'],
  autoReport: 'daily',
  staffHours: {
    doctor: { start: '08:00', end: '16:00', ot: 8 },
    nurse: { start: '07:00', end: '15:00', ot: 8 },
    staff: { start: '08:00', end: '16:00', ot: 8 },
    support: { start: '08:00', end: '16:00', ot: 8 }
  },
  shifts: [{ name: ' เช้า ', start: '08:00', end: '16:00', color: '#F59E0B' }, { name: 'ดึก', start: '00:00', end: '08:00', color: 'red' }]
});

test('accepts and normalizes valid settings', () => {
  const { value, error } = validateSettings(valid());
  assert.equal(error, undefined);
  assert.deepEqual(value.workDays, ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.equal(value.shifts[0].name, 'เช้า');
  assert.equal(value.shifts[1].color, '#6366F1');
});

test('rejects malformed settings', () => {
  assert.ok(validateSettings({ ...valid(), workStart: '8am' }).error);
  assert.ok(validateSettings({ ...valid(), lateMin: 500 }).error);
  assert.ok(validateSettings({ ...valid(), workDays: ['funday'] }).error);
  assert.ok(validateSettings({ ...valid(), shifts: [] }).error);
  assert.ok(validateSettings({ ...valid(), staffHours: {} }).error);
  assert.ok(validateSettings(null).error);
});
