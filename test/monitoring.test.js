const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, isWatchTime } = require('../src/services/scannerWatch');

const cfg = { silenceMin: 45, from: '07:30', to: '16:30', busyWeekly: 50 };
const at = s => new Date(`${s}+07:00`);          // Bangkok wall time
const WED = '2026-09-16';

test('watch window: working days, inside hours, not holidays', () => {
  const none = new Set();
  assert.equal(isWatchTime(at(`${WED}T10:00:00`), none, cfg), true);
  assert.equal(isWatchTime(at(`${WED}T06:59:00`), none, cfg), false, 'before the window');
  assert.equal(isWatchTime(at(`${WED}T17:00:00`), none, cfg), false, 'after the window');
  assert.equal(isWatchTime(at('2026-09-19T10:00:00'), none, cfg), false, 'Saturday');
  assert.equal(isWatchTime(at(`${WED}T10:00:00`), new Set([WED]), cfg), false, 'public holiday');
});

test('silence is measured from the later of the last scan and the window start', () => {
  const now = at(`${WED}T10:00:00`);
  const base = { now, watching: true, cfg, devices: [] };
  assert.equal(evaluate({ ...base, overallLast: `${WED} 09:30:00` }).overallSilent, false, '30 min');
  assert.equal(evaluate({ ...base, overallLast: `${WED} 09:10:00` }).overallSilent, true, '50 min');
  // Last scan yesterday evening: count from 07:30 today, so 07:50 is not an outage yet
  assert.equal(evaluate({ ...base, now: at(`${WED}T07:50:00`), overallLast: '2026-09-15 17:40:00' }).overallSilent, false);
  assert.equal(evaluate({ ...base, now: at(`${WED}T08:20:00`), overallLast: '2026-09-15 17:40:00' }).overallSilent, true);
  assert.equal(evaluate({ ...base, overallLast: null }).overallSilent, true, 'nothing in 7 days');
  assert.deepEqual(evaluate({ ...base, watching: false, overallLast: null }), { overallSilent: false, silentDevices: [] }, 'nights/weekends never alert');
});

test('one busy device going quiet is reported while the others work', () => {
  const now = at(`${WED}T11:00:00`);
  const devices = [
    { name: 'KHHin1', last: `${WED} 10:58:00`, weekCount: 900 },
    { name: 'KHHin2', last: `${WED} 09:20:00`, weekCount: 400 },   // 100 min quiet, busy → alert
    { name: 'Back door', last: `${WED} 08:00:00`, weekCount: 10 }    // rarely used → ignored
  ];
  const r = evaluate({ now, watching: true, cfg, overallLast: `${WED} 10:58:00`, devices });
  assert.deepEqual(r, { overallSilent: false, silentDevices: ['KHHin2'] });
  const all = evaluate({ now, watching: true, cfg, overallLast: `${WED} 09:00:00`, devices });
  assert.deepEqual(all.silentDevices, [], 'when everything is down only the overall alert is used');
});

test('HOSoffice leave codes and app leave labels map to leave buckets', () => {
  const { leaveBucket } = require('../src/services/hrExport');
  assert.equal(leaveBucket('ลาป่วย'), 'sick');
  assert.equal(leaveBucket('ป่วย'), 'sick');
  assert.equal(leaveBucket('ลากิจส่วนตัว'), 'personal');
  assert.equal(leaveBucket('ลาพักผ่อน'), 'vacation');
  assert.equal(leaveBucket('ลาคลอดบุตร'), 'other');
  assert.equal(leaveBucket(''), 'other');
});

test('review scope: admins everyone, heads their departments only', () => {
  const { canReview, scopeFilter } = require('../src/services/reviewScope');
  const head = { all: false, departments: [1], personIds: new Set(['1']), employeeIds: new Set(['1001', '1100000000001']) };
  assert.equal(canReview({ all: true }, { hrPersonId: 99 }), true);
  assert.equal(canReview(head, { hrPersonId: 1 }), true);
  assert.equal(canReview(head, { employeeId: '1100000000001' }), true, 'national-id username');
  assert.equal(canReview(head, { hrPersonId: 3, employeeId: '1003' }), false);
  assert.equal(canReview(null, { hrPersonId: 1 }), false);
  assert.deepEqual(scopeFilter({ all: true }, { personCol: 'p' }), { sql: '', params: [] });
  assert.deepEqual(scopeFilter(head, { personCol: 'hr_person_id', employeeCol: 'employee_id' }),
    { sql: '(hr_person_id IN (?) OR employee_id IN (?))', params: [['1'], ['1001', '1100000000001']] });
  assert.equal(scopeFilter({ all: false, personIds: new Set(), employeeIds: new Set() }, { personCol: 'x' }).sql, '1 = 0', 'empty department matches nothing');
  const { canAccess } = require('../src/constants/navigation');
  assert.equal(canAccess('reviewer', 'user', true), true);
  assert.equal(canAccess('reviewer', 'user', false), false);
  assert.equal(canAccess('admin', 'user', true), false, 'heads do not get admin menus');
});
