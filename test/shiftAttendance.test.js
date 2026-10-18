const test = require('node:test');
const assert = require('node:assert/strict');
const { shiftStartFor, dayPlan, judgeRosteredDay } = require('../src/utils/shiftAttendance');

const ms = s => new Date(`${s}+07:00`).getTime();

test('shift start comes from Settings by name, else the usual hospital times', () => {
  const settings = [{ name: 'เช้า', start: '07:30', end: '15:30' }, { name: 'OPD เย็น', start: '16:30', end: '20:30' }];
  assert.equal(shiftStartFor('MORNING', settings), '07:30', 'Settings override');
  assert.equal(shiftStartFor('AFTERNOON', settings), '16:00', 'default บ่าย');
  assert.equal(shiftStartFor('NIGHT', []), '00:00', 'default ดึก');
  assert.equal(shiftStartFor('OPD เย็น', settings), '16:30', 'custom shift by name');
  assert.equal(shiftStartFor('ไม่มีในระบบ', settings), null);
});

test('who is expected on which day', () => {
  assert.equal(dayPlan({ templateId: 1, rosterShift: null, isWorkday: true }), 'office');
  assert.equal(dayPlan({ templateId: 1, rosterShift: null, isWorkday: false }), 'off');
  assert.equal(dayPlan({ templateId: 1, rosterShift: 'MORNING', isWorkday: false }), 'roster', 'weekend duty counts');
  assert.equal(dayPlan({ templateId: 2, rosterShift: null, isWorkday: true }), 'off', 'shift worker on a day off');
  assert.equal(dayPlan({ templateId: 2, rosterShift: 'NIGHT', isWorkday: false }), 'roster');
});

test('rostered day: on time, late, absent — including a night shift that starts at midnight', () => {
  const scans = ['2026-09-22T15:52:00', '2026-09-23T00:05:00', '2026-09-23T23:50:00', '2026-09-25T09:10:00'].map(ms);
  const j = (date, start) => judgeRosteredDay({ date, start, lateMin: 30, scanMs: scans }).result;
  assert.equal(j('2026-09-22', '16:00'), 'ok', 'บ่าย: 8 minutes early');
  assert.equal(j('2026-09-24', '00:00'), 'ok', 'ดึก of the 24th: arrived 23:50 on the 23rd');
  assert.equal(j('2026-09-25', '08:00'), 'late', 'เช้า: 09:10 is past 08:30');
  assert.equal(j('2026-09-26', '08:00'), 'absent', 'no scan in the window');
  assert.equal(judgeRosteredDay({ date: '2026-09-23', start: '00:00', lateMin: 30, scanMs: scans }).result, 'ok', '00:05 within grace');
});

test('my-month day status precedence', () => {
  const { dayStatus } = require('../src/services/myMonth');
  assert.equal(dayStatus({ future: true, scanned: true }), 'future');
  assert.equal(dayStatus({ leave: 'ลาป่วย', absent: 'PENDING', scanned: false }), 'leave');
  assert.equal(dayStatus({ absent: 'OVERDUE' }), 'absent');
  assert.equal(dayStatus({ late: 'PENDING', scanned: true }), 'late');
  assert.equal(dayStatus({ scanned: true }), 'ok');
  assert.equal(dayStatus({ off: true }), 'off');
  assert.equal(dayStatus({}), 'none');
});

test('OT pay: weekday/holiday rates, daily cap across requests, per staff type', () => {
  const { priceOt, validate, DEFAULTS } = require('../src/services/otPay');
  const rates = { default: { ...DEFAULTS.default }, byStatus: { 'พยาบาล': { weekdayRate: 80, weekdayMaxHours: 4, holidayRate: 100, holidayMaxHours: 8 } } };
  const req = [
    { id: 1, employee_id: 'A', work_date: '2026-09-16', hours: 3 },      // Wed: 3 h × 50
    { id: 2, employee_id: 'A', work_date: '2026-09-16', hours: 2 },      // same day: only 1 h left under the 4 h cap
    { id: 3, employee_id: 'A', work_date: '2026-09-19', hours: 8 },      // Sat: capped at 7 h × 60
    { id: 4, employee_id: 'A', work_date: '2026-09-18', hours: 2 },      // public holiday (Fri) → holiday rate
    { id: 5, employee_id: 'N', work_date: '2026-09-16', hours: 5 }       // nurse: 4 h × 80
  ];
  const { lines, byEmployee } = priceOt(req, { rates, holidays: new Set(['2026-09-18']), statusOf: e => (e === 'N' ? 'พยาบาล' : null) });
  assert.deepEqual(lines.get(1), { dayType: 'weekday', rate: 50, paidHours: 3, amount: 150 });
  assert.deepEqual(lines.get(2), { dayType: 'weekday', rate: 50, paidHours: 1, amount: 50 });
  assert.deepEqual(lines.get(3), { dayType: 'holiday', rate: 60, paidHours: 7, amount: 420 });
  assert.deepEqual(lines.get(4), { dayType: 'holiday', rate: 60, paidHours: 2, amount: 120 });
  assert.deepEqual(lines.get(5), { dayType: 'weekday', rate: 80, paidHours: 4, amount: 320 });
  assert.deepEqual(byEmployee.A, { hours: 15, paidHours: 13, amount: 740 });
  assert.ok(validate({ default: { weekdayRate: 50, weekdayMaxHours: 4, holidayRate: 60, holidayMaxHours: 7 } }).value);
  assert.ok(validate({ default: { weekdayRate: -1, weekdayMaxHours: 4, holidayRate: 60, holidayMaxHours: 7 } }).error);
  assert.ok(validate({ default: DEFAULTS.default, byStatus: { 'x': { weekdayRate: 50, weekdayMaxHours: 30, holidayRate: 60, holidayMaxHours: 7 } } }).error, 'more than 24 h');
});
