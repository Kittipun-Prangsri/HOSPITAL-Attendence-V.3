const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOtRequest, otInterval, overlaps } = require('../src/utils/ot');

test('computes OT hours including overnight', () => {
  assert.equal(validateOtRequest({ work_date: '2026-10-16', start_time: '16:00', end_time: '20:30', reason: 'ER' }).value.hours, 4.5);
  assert.equal(validateOtRequest({ work_date: '2026-10-16', start_time: '22:00', end_time: '06:00', reason: 'เวรดึก' }).value.hours, 8);
});

test('rejects invalid OT requests', () => {
  assert.match(validateOtRequest({ work_date: 'x', start_time: '16:00', end_time: '18:00', reason: 'a' }).error, /วันที่/);
  assert.match(validateOtRequest({ work_date: '2026-10-16', start_time: '25:00', end_time: '18:00', reason: 'a' }).error, /เวลา/);
  assert.match(validateOtRequest({ work_date: '2026-10-16', start_time: '16:00', end_time: '16:15', reason: 'a' }).error, /30 นาที/);
  assert.match(validateOtRequest({ work_date: '2026-10-16', start_time: '16:00', end_time: '18:00', reason: '' }).error, /เหตุผล/);
});

test('detects overlapping OT intervals', () => {
  assert.equal(overlaps(otInterval('16:00', '20:00'), otInterval('19:00', '22:00')), true);
  assert.equal(overlaps(otInterval('16:00', '20:00'), otInterval('20:00', '22:00')), false);
  assert.equal(overlaps(otInterval('22:00', '02:00'), otInterval('23:00', '23:30')), true);
});
