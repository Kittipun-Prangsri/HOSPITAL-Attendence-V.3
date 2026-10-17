/**
 * End-to-end tests against a real MySQL server.
 *
 *   npm run test:integration
 *
 * Creates two throwaway databases (khh_test_hospital / khh_test_hosoffice), runs the real
 * migrations, boots the app with the MySQL session store, signs in through the login form and
 * exercises leave, OT, holidays, settings, excuses, monthly incidents, inbox and audit over HTTP.
 * The databases are dropped afterwards.
 *
 * Connection: INTEGRATION_DB_HOST / _PORT / _USER / _PASSWORD (default 127.0.0.1:3306 root, no password).
 * Safety: refuses to run unless both database names start with "khh_test_".
 */
const HOSPITAL_DB = process.env.INTEGRATION_DB_HOSPITAL || 'khh_test_hospital';
const HOSOFFICE_DB = process.env.INTEGRATION_DB_HOSOFFICE || 'khh_test_hosoffice';
if (!HOSPITAL_DB.startsWith('khh_test_') || !HOSOFFICE_DB.startsWith('khh_test_')) {
  throw new Error('Integration databases must be named khh_test_* — refusing to touch anything else.');
}

// Must be set before any app module loads dotenv (dotenv never overrides variables that already exist)
Object.assign(process.env, {
  DB_HOST: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
  DB_PORT: process.env.INTEGRATION_DB_PORT || '3306',
  DB_USER: process.env.INTEGRATION_DB_USER || 'root',
  DB_PASSWORD: process.env.INTEGRATION_DB_PASSWORD || '',
  DB_NAME_HOSPITAL: HOSPITAL_DB,
  DB_NAME_HOSOFFICE: HOSOFFICE_DB,
  SESSION_SECRET: 'integration-secret',
  SESSION_STORE: 'mysql',
  NODE_ENV: 'test',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_ADMIN_CHAT_ID: '',
  LINE_CHANNEL_ACCESS_TOKEN: '',
  LINE_ADMIN_USER_ID: '',
  GOOGLE_SHEET_URL: '',
  ENABLE_TELEGRAM_POLLING: 'false'
});

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const PASSWORD = 'Passw0rd!';
const DAY = '2026-09-16'; // Wednesday in a fully elapsed month, so results don't depend on today's date
const PDF = Buffer.from('%PDF-1.4\n% integration test\n').toString('base64');

let admin; // root connection used for setup / assertions
let app;
let server;
let base;
const users = {};
const createdFiles = [];

const days = n => Array.from({ length: n }, (_, i) => i + 1);
const cols = (prefixes, type = 'VARCHAR(50) NULL') => prefixes.flatMap(p => days(31).map(d => `${p}${d} ${type}`)).join(',\n');

async function setupDatabases() {
  admin = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, multipleStatements: true, timezone: '+07:00'
  });
  await admin.query(`DROP DATABASE IF EXISTS ${HOSPITAL_DB}; DROP DATABASE IF EXISTS ${HOSOFFICE_DB};
    CREATE DATABASE ${HOSPITAL_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE DATABASE ${HOSOFFICE_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);

  // HOSoffice tables: only the columns this system reads/writes (HR_STATUS_ID is text, compared as '01')
  await admin.query(`USE ${HOSOFFICE_DB};
    CREATE TABLE hr_department (HR_DEPARTMENT_ID INT PRIMARY KEY, HR_DEPARTMENT_NAME VARCHAR(255));
    CREATE TABLE hr_status (HR_STATUS_ID VARCHAR(10) PRIMARY KEY, HR_STATUS_NAME VARCHAR(100));
    CREATE TABLE hr_person (
      ID INT PRIMARY KEY, FINGLE_ID VARCHAR(50) NULL, HR_CID VARCHAR(20) NULL, HR_PREFIX_ID INT NULL,
      HR_FNAME VARCHAR(100), HR_LNAME VARCHAR(100), NICKNAME VARCHAR(100) NULL,
      HR_PHONE VARCHAR(50) NULL, HR_EMAIL VARCHAR(255) NULL, HR_DEPARTMENT_ID INT NULL, HR_POSITION_ID INT NULL,
      HR_STATUS_ID VARCHAR(10) NULL, HR_STARTWORK_DATE DATE NULL,
      LINE_YOUR_USER_ID VARCHAR(255) NULL, TELEGRAM_CHAT_ID VARCHAR(100) NULL,
      LINE_TOKEN VARCHAR(255) NULL, LINE_TOKEN1 VARCHAR(255) NULL, LINE_TOKEN2 VARCHAR(255) NULL, PERMIS_ID VARCHAR(50) NULL,
      WORK_SHIFT VARCHAR(50) NULL, TIME_IN VARCHAR(20) NULL, TIME_OUT VARCHAR(20) NULL,
      USER_TYPE VARCHAR(20) NULL, HR_PASSWORD_HASH VARCHAR(255) NULL
    );
    CREATE TABLE hiling_time_template (ID INT PRIMARY KEY, HILING_TIME_NAME VARCHAR(255) NULL);
    CREATE TABLE hr_person_hiling_time (HR_PERSON_ID INT PRIMARY KEY, TEMPLATE_ID INT);
    CREATE TABLE hikvision (
      id INT AUTO_INCREMENT PRIMARY KEY, EmployeeID VARCHAR(50), AccessDateandTime VARCHAR(50), AccessDate DATE, AccessTime TIME,
      AuthenticationResult VARCHAR(50), AuthenticationType VARCHAR(50), DeviceName VARCHAR(100), DeviceSerialNo VARCHAR(100),
      ReaderName VARCHAR(100), FirstName VARCHAR(100), LastName VARCHAR(100), PersonName VARCHAR(100), PersonGroup VARCHAR(100),
      CardNumber VARCHAR(50), Direction VARCHAR(20), SkinSurfaceTemperature VARCHAR(20), TemperatureStatus VARCHAR(20),
      AttendanceStatus VARCHAR(10), is_notified TINYINT DEFAULT 0
    );
    CREATE TABLE service_work_scans_morning (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['di'])});
    CREATE TABLE service_work_scans_afternoon (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['do'])});
    CREATE TABLE service_work_scans_night (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['d'])});
    CREATE TABLE service_work_scans_8_morning (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['dmi', 'dmo'])});
    CREATE TABLE service_work_scans_8_afternoon (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['dai', 'dao'])});
    CREATE TABLE service_work_scans_8_night (hr_person_id INT, year_and_month VARCHAR(7), ${cols(['dni', 'dno'])});
  `);

  const hash = await bcrypt.hash(PASSWORD, 4);
  await admin.query(`
    INSERT INTO hr_department VALUES (1, 'กลุ่มงานการพยาบาล'), (2, 'กลุ่มงานสุขภาพดิจิทัล');
    INSERT INTO hr_status VALUES ('01', 'ข้าราชการ'), ('02', 'ลูกจ้างชั่วคราว');
    INSERT INTO hiling_time_template VALUES (1, NULL);`);
  const people = [
    [1, '1001', '1100000000001', 'สมหญิง', 'ทดสอบ', 1, '01', 'USER', 'Utest1001'],
    [2, '1002', '1100000000002', 'สมชาย', 'ลูกจ้าง', 1, '02', 'USER', null],
    [3, '1003', '1100000000003', 'ผู้ดูแล', 'ระบบ', 2, '01', 'ADMIN', null],
    [4, '1004', '1100000000004', 'ซูเปอร์', 'แอดมิน', 2, '01', 'SUPER', null]
  ];
  for (const [id, fingle, cid, fn, ln, dept, status, type, line] of people) {
    await admin.query(
      `INSERT INTO hr_person (ID, FINGLE_ID, HR_CID, HR_FNAME, HR_LNAME, HR_DEPARTMENT_ID, HR_STATUS_ID, USER_TYPE, HR_PASSWORD_HASH, LINE_YOUR_USER_ID, WORK_SHIFT)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'เช้า')`, [id, fingle, cid, fn, ln, dept, status, type, hash, line]);
    await admin.query('INSERT INTO hr_person_hiling_time VALUES (?, 1)', [id]);
  }
  // 1001 in 07:55 / out 16:10 · 1002 in 08:45 (late under defaults) · 1003, 1004 no scan
  await admin.query(`INSERT INTO hikvision (EmployeeID, AccessDate, AccessTime, Direction, AuthenticationResult) VALUES
    ('1001', ?, '07:55:00', 'in', 'Success'), ('1001', ?, '16:10:00', 'out', 'Success'), ('1002', ?, '08:45:00', 'in', 'Success')`, [DAY, DAY, DAY]);
}

/* ---------------- tiny HTTP client with cookie + CSRF ---------------- */
async function login(username) {
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: PASSWORD })
  });
  assert.equal(res.status, 302, `login ${username} should redirect`);
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const page = await (await fetch(`${base}/leave`, { headers: { Cookie: cookie } })).text();
  const csrf = (page.match(/name="csrf-token" content="([a-f0-9]+)"/) || [])[1];
  assert.ok(csrf, 'page should embed a CSRF token');
  return { cookie, csrf };
}

async function call(who, method, path, body, { csrf = true } = {}) {
  const headers = { Cookie: who.cookie, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = who.csrf;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
}

const findEmp = (data, id) => data.employees.find(e => String(e.id) === id);
const incidents = async (emp, date) => (await admin.query(
  `SELECT incident_type, status FROM ${HOSPITAL_DB}.incident_logs WHERE employee_id = ? AND incident_date = ?`, [emp, date]))[0];

/* ---------------- lifecycle ---------------- */
test.before(async () => {
  await setupDatabases();
  const { runMigrations } = require('../../scripts/migrations');
  await runMigrations();
  app = require('../../src/app');
  if (app.locals.sessionStore && app.locals.sessionStore.onReady) await app.locals.sessionStore.onReady();
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  users.staff = await login('1001');
  users.temp = await login('1100000000002'); // sign in with national ID instead of FINGLE_ID
  users.admin = await login('1003');
  users.super = await login('1004');
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  const { pool, hosofficePool } = require('../../src/config/db');
  if (app && app.locals.sessionStore) await app.locals.sessionStore.close().catch(() => {});
  await Promise.allSettled([pool.end(), hosofficePool.end()]);
  const { resolveAttachment } = require('../../src/utils/attachments');
  createdFiles.forEach(f => { const p = resolveAttachment(f); if (p) fs.rmSync(p, { force: true }); });
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${HOSPITAL_DB}; DROP DATABASE IF EXISTS ${HOSOFFICE_DB};`);
    await admin.end();
  }
});

/* ---------------- scenarios (run in order) ---------------- */
test('migrations created every table and sessions persist in MySQL', async () => {
  const [tables] = await admin.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [HOSPITAL_DB]);
  const names = tables.map(r => r.t || r.TABLE_NAME);
  for (const t of ['schema_migrations', 'leave_requests', 'app_settings', 'holidays', 'ot_requests', 'audit_log', 'incident_logs', 'scan_outages', 'sessions']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  const [[{ n }]] = await admin.query(`SELECT COUNT(*) AS n FROM ${HOSPITAL_DB}.sessions`);
  assert.ok(n >= 4, 'each login should have a persisted session');
});

test('dashboard data applies the default late rule', async () => {
  const { status, body } = await call(users.admin, 'GET', `/api/data?date=${DAY}`);
  assert.equal(status, 200);
  assert.equal(findEmp(body, '1001').status, 'out');
  assert.equal(findEmp(body, '1002').status, 'late');
  assert.equal(findEmp(body, '1003').status, 'none');
  assert.equal((await call(users.admin, 'GET', '/api/data?date=2026-99-99')).status, 400);
});

test('state-changing calls without the CSRF token are rejected', async () => {
  const res = await call(users.staff, 'POST', '/api/leaves', { leave_type: 'sick' }, { csrf: false });
  assert.equal(res.status, 403);
});

test('admin adds a holiday; leave counting skips it', async () => {
  assert.equal((await call(users.admin, 'POST', '/api/holidays', { date: '2026-09-18', name: 'วันหยุดทดสอบ' })).status, 200);
  assert.equal((await call(users.staff, 'POST', '/api/holidays', { date: '2026-09-25', name: 'x' })).status, 403);
  const created = await call(users.staff, 'POST', '/api/leaves', {
    leave_type: 'sick', start_date: '2026-09-17', end_date: '2026-09-21', reason: 'ไข้หวัด'
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const mine = (await call(users.staff, 'GET', '/api/leaves')).body.leaves;
  assert.equal(Number(mine.find(l => l.start_date === '2026-09-17').days), 2); // Thu + Mon (Fri holiday, weekend)
  const overlap = await call(users.staff, 'POST', '/api/leaves', { leave_type: 'personal', start_date: '2026-09-21', end_date: '2026-09-22', reason: 'ธุระ' });
  assert.equal(overlap.status, 409);
});

test('sick leave of 3+ days needs a certificate that only owner and reviewers can open', async () => {
  const body = { leave_type: 'sick', start_date: '2026-09-22', end_date: '2026-09-24', reason: 'พักฟื้น' };
  const missing = await call(users.staff, 'POST', '/api/leaves', body);
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /ใบรับรองแพทย์/);
  const spoofed = await call(users.staff, 'POST', '/api/leaves', { ...body, attachment: { name: 'x.pdf', type: 'application/pdf', data: Buffer.from('<html>').toString('base64') } });
  assert.equal(spoofed.status, 400);
  const ok = await call(users.staff, 'POST', '/api/leaves', { ...body, attachment: { name: 'ใบรับรองแพทย์.pdf', type: 'application/pdf', data: PDF } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const [[row]] = await admin.query(`SELECT attachment_path FROM ${HOSPITAL_DB}.leave_requests WHERE id = ?`, [ok.body.id]);
  createdFiles.push(row.attachment_path);
  const asOwner = await call(users.staff, 'GET', `/api/leaves/${ok.body.id}/attachment`);
  assert.equal(asOwner.status, 200);
  assert.match(asOwner.type, /application\/pdf/);
  assert.equal((await call(users.temp, 'GET', `/api/leaves/${ok.body.id}/attachment`)).status, 403);
  assert.equal((await call(users.admin, 'GET', `/api/leaves/${ok.body.id}/attachment`)).status, 200);
});

test('approval flow: reviewers only, once, never their own; dashboard shows the leave', async () => {
  const pending = (await call(users.admin, 'GET', '/api/leaves?scope=all&status=pending')).body.leaves;
  const first = pending.find(l => l.start_date === '2026-09-17');
  assert.equal((await call(users.staff, 'POST', `/api/leaves/${first.id}/review`, { status: 'approved' })).status, 403);
  assert.equal((await call(users.admin, 'POST', `/api/leaves/${first.id}/review`, { status: 'approved', comment: 'หายไว ๆ' })).status, 200);
  assert.equal((await call(users.admin, 'POST', `/api/leaves/${first.id}/review`, { status: 'rejected' })).status, 409);

  const own = await call(users.admin, 'POST', '/api/leaves', { leave_type: 'personal', start_date: '2026-09-28', end_date: '2026-09-28', reason: 'ธุระ' });
  assert.equal((await call(users.admin, 'POST', `/api/leaves/${own.body.id}/review`, { status: 'approved' })).status, 403);

  const dash = (await call(users.admin, 'GET', '/api/data?date=2026-09-17')).body;
  assert.equal(findEmp(dash, '1001').status, 'leave');
  assert.match(findEmp(dash, '1001').leave_status, /ลาป่วย/);

  const bal = (await call(users.staff, 'GET', '/api/leaves/balance?date=2026-09-17')).body;
  assert.equal(bal.staffStatus, 'ข้าราชการ');
  assert.equal(bal.balance.sick.used, 2);
  assert.equal(bal.balance.sick.pending, 3);
  assert.equal(bal.balance.sick.remaining, 55);
});

test('staff-type quotas: only super can edit; temporary staff get no vacation', async () => {
  const policy = { attachmentSickDays: 3, byStatus: { 'ลูกจ้างชั่วคราว': { vacation: 0 } } };
  assert.equal((await call(users.admin, 'PUT', '/api/leave-policy', policy)).status, 403);
  assert.equal((await call(users.super, 'PUT', '/api/leave-policy', policy)).status, 200);
  const res = await call(users.temp, 'POST', '/api/leaves', { leave_type: 'vacation', start_date: '2026-09-25', end_date: '2026-09-25', reason: 'พักผ่อน' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /คงเหลือ 0/);
});

test('monthly incidents respect leave/holidays and refresh after an excuse is approved', async () => {
  const excuse = await call(users.temp, 'POST', '/api/excuses', { date: DAY, issue_type: 'late', reason: 'รถติด' });
  assert.equal(excuse.status, 200);

  let report = await call(users.admin, 'GET', '/api/report/monthly?month=9&year=2026');
  assert.equal(report.status, 200);
  assert.deepEqual(await incidents('1002', DAY), [{ incident_type: 'LATE', status: 'PENDING' }]);
  assert.deepEqual((await incidents('1003', DAY)).map(r => r.incident_type), ['ABSENT']);
  assert.deepEqual(await incidents('1001', '2026-09-17'), [], 'approved leave day is not absent');
  assert.deepEqual(await incidents('1001', '2026-09-21'), [], 'approved leave day is not absent');
  assert.deepEqual(await incidents('1003', '2026-09-18'), [], 'holiday is not absent');
  assert.deepEqual(await incidents('1003', '2026-09-19'), [], 'weekend is not absent');
  const p1 = report.body.report.find(r => String(r.id) === '1001');
  assert.equal(p1.leaveCount, 2, 'approved in-app leave days count as leave');

  const list = (await call(users.admin, 'GET', '/api/excuses')).body.excuses;
  const mine = list.find(e => e.username === '1002');
  assert.equal(mine.fullname, 'สมชาย ลูกจ้าง', 'excuse owner resolved by FINGLE_ID');
  assert.equal((await call(users.admin, 'POST', '/api/excuses/review', { id: mine.id, status: 'bogus' })).status, 400);
  assert.equal((await call(users.admin, 'POST', '/api/excuses/review', { id: mine.id, status: 'approved' })).status, 200);

  report = await call(users.admin, 'GET', '/api/report/monthly?month=9&year=2026');
  assert.deepEqual(await incidents('1002', DAY), [{ incident_type: 'LATE', status: 'SUBMITTED' }], 'approval marks the month stale and resyncs');
});

test('saving settings changes the late rule everywhere immediately', async () => {
  const settings = {
    workStart: '08:00', workEnd: '16:00', lateMin: 60, workDays: ['mon', 'tue', 'wed', 'thu', 'fri'], autoReport: 'none',
    staffHours: Object.fromEntries(['doctor', 'nurse', 'staff', 'support'].map(k => [k, { start: '08:00', end: '16:00', ot: 8 }])),
    shifts: [{ name: 'เช้า', start: '08:00', end: '16:00', color: '#F59E0B' }]
  };
  assert.equal((await call(users.staff, 'PUT', '/api/settings', settings)).status, 403);
  assert.equal((await call(users.admin, 'PUT', '/api/settings', settings)).status, 200);
  const dash = (await call(users.admin, 'GET', `/api/data?date=${DAY}&lateMin=1`)).body; // stale client param is ignored
  assert.equal(findEmp(dash, '1002').status, 'in');
});

test('partial staff update keeps untouched columns', async () => {
  assert.equal((await call(users.staff, 'POST', '/api/staff/update', { id: '1001', nickname: 'หญิง' })).status, 200);
  const [[row]] = await admin.query(`SELECT NICKNAME, LINE_YOUR_USER_ID, WORK_SHIFT FROM ${HOSOFFICE_DB}.hr_person WHERE ID = 1`);
  assert.deepEqual(row, { NICKNAME: 'หญิง', LINE_YOUR_USER_ID: 'Utest1001', WORK_SHIFT: 'เช้า' });
  assert.equal((await call(users.staff, 'POST', '/api/staff/update', { id: '1002', nickname: 'x' })).status, 403);
});

test('OT request, overlap guard and approval', async () => {
  const ot = await call(users.staff, 'POST', '/api/ot', { work_date: DAY, start_time: '16:30', end_time: '20:00', reason: 'ER' });
  assert.equal(ot.status, 200);
  assert.equal((await call(users.staff, 'POST', '/api/ot', { work_date: DAY, start_time: '19:00', end_time: '21:00', reason: 'ซ้อน' })).status, 409);
  assert.equal((await call(users.admin, 'POST', `/api/ot/${ot.body.id}/review`, { status: 'approved' })).status, 200);
  const mine = (await call(users.staff, 'GET', '/api/ot')).body.requests;
  assert.equal(mine[0].status, 'approved');
  assert.equal(Number(mine[0].hours), 3.5);
});

test('inbox and audit trail reflect what happened', async () => {
  const inbox = (await call(users.admin, 'GET', '/api/notifications/inbox')).body;
  assert.equal(inbox.counts.pendingLeaves, 2); // staff's 3-day sick leave + admin's own request
  assert.ok(inbox.items.some(i => i.href.startsWith('/leave')));
  const staffInbox = (await call(users.staff, 'GET', '/api/notifications/inbox')).body;
  assert.ok(staffInbox.items.some(i => /อนุมัติแล้ว/.test(i.title)), 'staff sees their approved leave/OT');

  assert.equal((await call(users.admin, 'GET', '/api/audit')).status, 403);
  const audit = (await call(users.super, 'GET', '/api/audit?limit=500')).body;
  const seen = new Set(audit.rows.map(r => `${r.action}:${r.entity}`));
  for (const k of ['login:auth', 'create:leave', 'approve:leave', 'upsert:holiday', 'update:settings', 'update:leave_policy', 'approve:excuse', 'approve:ot', 'update:staff', 'view:leave_attachment']) {
    assert.ok(seen.has(k), `audit should contain ${k}`);
  }
});

test('health probe reports both databases', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.hospitalDb.ok, true);
  assert.equal(body.checks.hosofficeDb.ok, true);
});

test('shift names are stored as one canonical code and shown in Thai', async () => {
  const save = await call(users.admin, 'POST', '/api/schedule/save', { year: 2026, month: 9, schedule: { 1001: { 16: 'เช้า' }, 1002: { 16: 'บ่าย' }, 1003: { 16: 'เวรพิเศษ OR' } } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const [rows] = await admin.query(`SELECT employee_id, shift FROM ${HOSPITAL_DB}.schedule_entries WHERE schedule_date = ? ORDER BY employee_id`, [DAY]);
  assert.deepEqual(rows.map(r => r.shift), ['MORNING', 'AFTERNOON', 'เวรพิเศษ OR']);

  const weekly = await call(users.admin, 'POST', '/api/schedule', { emp_id: '1004', shift: 'NIGHT', date: DAY });
  assert.equal(weekly.status, 200);
  const load = (await call(users.admin, 'GET', '/api/schedule/load?year=2026&month=9')).body.data.schedule;
  assert.equal(load['1001'][16], 'เช้า');
  assert.equal(load['1004'][16], 'ดึก');
  const dash = (await call(users.admin, 'GET', `/api/data?date=${DAY}`)).body;
  assert.equal(findEmp(dash, '1001').shift, 'morning');
  const staff = (await call(users.staff, 'GET', '/api/schedule/staff/1001/2026-09')).body;
  assert.deepEqual(staff.shifts, [{ day: 16, shift: 'เช้า' }]);

  // Legacy rows written by both old screens are converted by migration 006
  await admin.query(`INSERT INTO ${HOSPITAL_DB}.schedule_entries (employee_id, schedule_date, shift) VALUES ('1002', '2026-09-17', 'เช้า'), ('1003', '2026-09-17', 'morning'), ('1004', '2026-09-17', ' ดึก ')`);
  const { migrations } = require('../../scripts/migrations');
  await migrations.find(m => m.id === '006_canonical_shift_codes').up();
  const [legacy] = await admin.query(`SELECT shift FROM ${HOSPITAL_DB}.schedule_entries WHERE schedule_date = '2026-09-17' ORDER BY employee_id`);
  assert.deepEqual(legacy.map(r => r.shift), ['MORNING', 'MORNING', 'NIGHT']);
});

test('incident rebuild removes stale rows left by the old date bug', async () => {
  // A wrong ABSENT for someone who scanned in, as the pre-fix sync produced
  await admin.query(`INSERT INTO ${HOSPITAL_DB}.incident_logs (employee_id, incident_date, incident_type, status) VALUES ('1001', ?, 'ABSENT', 'OVERDUE')`, [DAY]);
  const { rebuildIncidents } = require('../../src/services/incidentRebuild');
  const { syncIncidentsForMonth } = require('../../src/controllers/apiController');
  const dry = await rebuildIncidents({ from: '2026-09', to: '2026-09', dryRun: true, syncFn: syncIncidentsForMonth });
  assert.equal(dry[0].after, null);
  assert.deepEqual(await incidents('1001', DAY), [{ incident_type: 'ABSENT', status: 'OVERDUE' }], 'dry run changes nothing');
  const [result] = await rebuildIncidents({ from: '2026-09', to: '2026-09', dryRun: false, syncFn: syncIncidentsForMonth });
  assert.ok(result.after > 0);
  assert.deepEqual(await incidents('1001', DAY), []);
  // Settings now allow 60 minutes (threshold 09:00), so the 08:45 scan is no longer late after a rebuild
  assert.deepEqual(await incidents('1002', DAY), [], 'rebuild applies the current late threshold');
  assert.deepEqual((await incidents('1003', DAY)).map(r => r.incident_type), ['ABSENT']);
});

test('a plain sync prunes incidents that no longer apply', async () => {
  const { syncIncidentsForMonth } = require('../../src/controllers/apiController');
  await admin.query(`INSERT INTO ${HOSPITAL_DB}.incident_logs (employee_id, incident_date, incident_type, status) VALUES ('1001', ?, 'ABSENT', 'OVERDUE')`, [DAY]);
  await admin.query(`INSERT INTO ${HOSPITAL_DB}.incident_logs (employee_id, incident_date, incident_type, status) VALUES ('1003', '2026-09-18', 'ABSENT', 'OVERDUE')`);
  await syncIncidentsForMonth(2026, 9);
  assert.deepEqual(await incidents('1001', DAY), [], 'scanned in, so the ABSENT row is removed');
  assert.deepEqual(await incidents('1003', '2026-09-18'), [], 'holiday added after a sync no longer leaves a stale ABSENT');
  assert.deepEqual((await incidents('1003', DAY)).map(r => r.incident_type), ['ABSENT'], 'real absences stay');
});

test('scanner outage clears absences in its range and they return when it is removed', async () => {
  const { syncIncidentsForMonth } = require('../../src/controllers/apiController');
  const range = { start_date: '2026-09-14', end_date: DAY, reason: 'เครื่องสแกนดับ' };
  assert.equal((await call(users.staff, 'POST', '/api/scan-outages', range)).status, 403);
  assert.equal((await call(users.admin, 'POST', '/api/scan-outages', { ...range, end_date: '2026-09-01' })).status, 400);
  const saved = await call(users.admin, 'POST', '/api/scan-outages', range);
  assert.equal(saved.status, 200);
  assert.ok(saved.body.removed >= 1);
  assert.deepEqual(await incidents('1003', DAY), [], 'ABSENT inside the outage is cleared');

  await syncIncidentsForMonth(2026, 9);
  assert.deepEqual(await incidents('1003', DAY), [], 'resync does not recreate it');
  assert.deepEqual((await incidents('1003', '2026-09-22')).map(r => r.incident_type), ['ABSENT'], 'days outside the range still count');

  const list = (await call(users.admin, 'GET', '/api/scan-outages')).body.outages;
  assert.equal(list.length, 1);
  assert.equal(list[0].start_date, '2026-09-14');
  assert.equal((await call(users.admin, 'DELETE', `/api/scan-outages/${list[0].id}`)).status, 200);
  await syncIncidentsForMonth(2026, 9);
  assert.deepEqual((await incidents('1003', DAY)).map(r => r.incident_type), ['ABSENT'], 'absence is back after the outage is removed');
});

test('chatbot shows scan history only to linked staff: own data, or everyone for admins', async () => {
  const chatbot = require('../../src/services/chatbotService');
  const thaiDay = `สแกน วันที่ ${DAY.slice(8, 10)}/${DAY.slice(5, 7)}/${DAY.slice(0, 4)}`;
  assert.match(await chatbot.handleMessage('1', 'Ustranger'), /ยังไม่ได้ผูก/, 'unknown LINE user gets nothing');
  assert.match(await chatbot.handleMessage(thaiDay, 'Ustranger'), /ยังไม่ได้ผูก/);

  const own = await chatbot.handleMessage(thaiDay, 'Utest1001');
  assert.match(own, /สมหญิง/);
  assert.doesNotMatch(own, /สมชาย/, 'regular staff never see colleagues');
  const asked = await chatbot.handleMessage('1 1002', 'Utest1001');
  assert.match(asked, /เฉพาะข้อมูลของตนเอง/);
  assert.doesNotMatch(asked, /สมชาย/);

  await admin.query(`UPDATE ${HOSOFFICE_DB}.hr_person SET TELEGRAM_CHAT_ID = '555' WHERE FINGLE_ID = '1003'`);
  const all = await chatbot.handleMessage(thaiDay, '555');
  assert.match(all, /สมหญิง/);
  assert.match(all, /สมชาย/, 'admins can see the whole hospital');
});

test('latest scan card is available as a free LINE reply', async () => {
  const chatbot = require('../../src/services/chatbotService');
  assert.match(await chatbot.handlePostback('action=latest_scan', 'Ustranger'), /ยังไม่ได้ผูก/);
  // Fixture scans are on DAY, outside the 7-day window relative to today unless DAY is recent
  await admin.query(`INSERT INTO ${HOSOFFICE_DB}.hikvision (EmployeeID, AccessDate, AccessTime, Direction, AuthenticationResult, DeviceName)
    VALUES ('1001', CURDATE(), '09:30:00', 'in', 'Success', 'KHHin2')`);
  const card = await chatbot.handlePostback('action=latest_scan', 'Utest1001');
  assert.equal(card.type, 'bubble');
  const text = JSON.stringify(card);
  assert.match(text, /สมหญิง/);
  assert.match(text, /09:30/);
  assert.match(text, /KHHin2/);
});

test('a deep link from the LINE rich menu returns to that page after login', async () => {
  const first = await fetch(`${base}/schedule`, { redirect: 'manual' });
  assert.equal(first.status, 302);
  assert.match(first.headers.get('location'), /\/login$/);
  const cookie = first.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ username: '1001', password: PASSWORD })
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/schedule');
  // An off-site target is never honoured
  const evil = await fetch(`${base}//evil.example/x`, { redirect: 'manual' });
  assert.notEqual(evil.headers.get('location'), '//evil.example/x');
});

test('escalation finds approvals pending for more than two days', async () => {
  const { collectStalePending, formatEscalation } = require('../../src/services/pendingEscalation');
  assert.equal((await collectStalePending(2)).leaves.length, 0);
  await admin.query(`UPDATE ${HOSPITAL_DB}.leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 3 DAY) WHERE status = 'pending'`);
  const stale = await collectStalePending(2);
  assert.equal(stale.leaves.length, 2);
  assert.match(formatEscalation(stale), /ใบลา 2 รายการ/);
});
