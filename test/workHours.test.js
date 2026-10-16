const test = require('node:test');
const assert = require('node:assert/strict');
const { spanHours, dailyHours, summarizeHours } = require('../public/js/work-hours');

test('spanHours handles normal and overnight shifts', () => {
  assert.equal(spanHours('08:00', '16:30'), 8.5);
  assert.equal(spanHours('23:50:00', '08:05'), 8.25);
  assert.equal(spanHours('08:00', ''), 0);
  assert.equal(spanHours('ลาพักผ่อน', '16:00'), 0);
  assert.equal(spanHours('07:00', '07:00'), 0);
});

test('treats implausibly long gaps as missing scans', () => {
  assert.equal(spanHours('08:00', '07:00'), 0); // 23h
});

test('dailyHours for normal template pairs morning-in with afternoon-out', () => {
  const rows = { morning: { di1: '07:55', di2: '08:10' }, afternoon: { do1: '16:05', do2: null } };
  assert.deepEqual(dailyHours(rows, '1', 3), [8.17, 0, 0]);
});

test('dailyHours for 8-hour shifts sums every shift in the day', () => {
  const rows = { morning: { dmi1: '08:00', dmo1: '16:00' }, afternoon: { dai1: '16:00', dao1: '24:00' }, night: {} };
  assert.deepEqual(dailyHours(rows, '2', 1), [16]);
});

test('summarizeHours computes totals, average and overtime', () => {
  assert.deepEqual(summarizeHours([8, 0, 10, 16], 8), { days: 3, total: 34, avg: 11.3, ot: 10, max: 16 });
});
