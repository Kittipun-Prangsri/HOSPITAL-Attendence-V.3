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
  for (const t of ['schema_migrations', 'leave_requests', 'app_settings', 'holidays', 'ot_requests', 'audit_log', 'incident_logs', 'sessions']) {
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
