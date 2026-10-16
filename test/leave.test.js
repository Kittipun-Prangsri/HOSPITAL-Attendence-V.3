const test = require('node:test');
const assert = require('node:assert/strict');
const { countLeaveDays, fiscalYearOf, validateLeaveRequest, summarizeBalance } = require('../src/utils/leave');

test('counts working days only for sick leave', () => {
  // 2026-10-16 is a Friday → Fri + Mon + Tue
  assert.equal(countLeaveDays('2026-10-16', '2026-10-20', 'sick'), 3);
});

test('counts calendar days for maternity leave', () => {
  assert.equal(countLeaveDays('2026-10-16', '2026-10-20', 'maternity'), 5);
});

test('half day counts 0.5 and only on a single working day', () => {
  assert.equal(countLeaveDays('2026-10-16', '2026-10-16', 'personal', 'morning'), 0.5);
  assert.equal(countLeaveDays('2026-10-17', '2026-10-17', 'personal', 'morning'), 0);
  assert.equal(countLeaveDays('2026-10-16', '2026-10-19', 'personal', 'morning'), 0);
});

test('fiscal year starts in October', () => {
  assert.deepEqual(fiscalYearOf('2026-10-01'), { label: 2570, start: '2026-10-01', end: '2027-09-30' });
  assert.deepEqual(fiscalYearOf('2026-09-30'), { label: 2569, start: '2025-10-01', end: '2026-09-30' });
});

test('rejects invalid leave requests', () => {
  assert.match(validateLeaveRequest({ leave_type: 'x', start_date: '2026-10-16', end_date: '2026-10-16', reason: 'a' }).error, /ประเภท/);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-10-20', end_date: '2026-10-16', reason: 'a' }).error, /สิ้นสุด/);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-10-17', end_date: '2026-10-18', reason: 'a' }).error, /วันทำการ/);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-09-30', end_date: '2026-10-01', reason: 'a' }).error, /ปีงบประมาณ/);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-10-16', end_date: '2026-10-16', reason: ' ' }).error, /เหตุผล/);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-02-30', end_date: '2026-03-01', reason: 'a' }).error, /วันที่/);
});

test('accepts a valid request and computes days', () => {
  const { value } = validateLeaveRequest({ leave_type: 'vacation', start_date: '2026-10-19', end_date: '2026-10-23', reason: ' พักผ่อน ' });
  assert.equal(value.days, 5);
  assert.equal(value.reason, 'พักผ่อน');
  assert.equal(value.halfDay, 'none');
});

test('balance counts approved as used and pending as reserved', () => {
  const balance = summarizeBalance([
    { leave_type: 'vacation', days: '3.0', status: 'approved' },
    { leave_type: 'vacation', days: '1.5', status: 'pending' },
    { leave_type: 'vacation', days: '2.0', status: 'rejected' },
    { leave_type: 'other', days: '1.0', status: 'approved' }
  ]);
  assert.equal(balance.vacation.used, 3);
  assert.equal(balance.vacation.pending, 1.5);
  assert.equal(balance.vacation.remaining, 5.5);
  assert.equal(balance.other.remaining, null);
});

test('public holidays are skipped for working-day leave types only', () => {
  const holidays = new Set(['2026-10-23']); // วันปิยมหาราช (Fri)
  assert.equal(countLeaveDays('2026-10-19', '2026-10-23', 'vacation', 'none', holidays), 4);
  assert.equal(countLeaveDays('2026-10-19', '2026-10-23', 'maternity', 'none', holidays), 5);
  assert.equal(countLeaveDays('2026-10-23', '2026-10-23', 'sick', 'morning', holidays), 0);
  assert.match(validateLeaveRequest({ leave_type: 'sick', start_date: '2026-10-23', end_date: '2026-10-23', reason: 'a' }, holidays).error, /วันทำการ/);
});

test('staff-type quotas override defaults and feed the balance', () => {
  const { quotasForStatus } = require('../src/utils/leave');
  const policy = { byStatus: { 'ลูกจ้างชั่วคราว': { vacation: 0, sick: 30, other: null } } };
  const q = quotasForStatus(policy, 'ลูกจ้างชั่วคราว');
  assert.equal(q.vacation, 0);
  assert.equal(q.sick, 30);
  assert.equal(q.personal, 45);
  assert.equal(quotasForStatus(policy, 'ข้าราชการ').vacation, 10);
  const b = summarizeBalance([{ leave_type: 'sick', days: 5, status: 'approved' }], q);
  assert.equal(b.sick.remaining, 25);
  assert.equal(b.vacation.remaining, 0);
});

test('medical certificate threshold for sick leave', () => {
  const { attachmentRequired } = require('../src/utils/leave');
  assert.equal(attachmentRequired({ attachmentSickDays: 3 }, 'sick', 3), true);
  assert.equal(attachmentRequired({ attachmentSickDays: 3 }, 'sick', 2.5), false);
  assert.equal(attachmentRequired({ attachmentSickDays: 3 }, 'personal', 5), false);
  assert.equal(attachmentRequired({ attachmentSickDays: 0 }, 'sick', 10), false);
});
