// Boots the real Express app (memory sessions, no DB queries on these paths) and checks the
// security behaviour end-to-end over HTTP.
process.env.SESSION_STORE = 'memory';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
// Never reach real infrastructure from tests (dotenv does not override variables already set)
for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_ADMIN_USER_ID', 'GOOGLE_SHEET_URL']) process.env[key] = '';
process.env.DB_HOST = '127.0.0.1';
process.env.LINE_CHANNEL_SECRET = 'line-test-secret';
delete process.env.ATTENDANCE_PUSH_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let server;
let base;
test.before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('login page is served with security headers', async () => {
  const res = await fetch(`${base}/login`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('API calls without a session get JSON 401 instead of a login redirect', async () => {
  const res = await fetch(`${base}/api/leaves`, { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).loginRequired, true);
  const post = await fetch(`${base}/api/leaves`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(post.status, 401);
});

test('pages without a session still redirect to login', async () => {
  const res = await fetch(`${base}/leave`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('leave upload route accepts bodies above the global 100kb limit', async () => {
  const big = JSON.stringify({ attachment: { data: 'A'.repeat(300 * 1024) } });
  const leave = await fetch(`${base}/api/leaves`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.equal(leave.status, 401); // reached auth, not rejected as 413
  const other = await fetch(`${base}/api/ot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.equal(other.status, 413);
});

test('trusts one proxy hop so cookies/req.ip work behind ngrok', () => {
  const app = require('../src/app');
  assert.equal(app.get('trust proxy'), 1);
});

test('LINE webhook only accepts requests signed with the channel secret', async () => {
  const crypto = require('crypto');
  const body = JSON.stringify({ destination: 'x', events: [] });
  const post = signature => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Line-Signature': signature } : {}) }, body });
  assert.equal((await post()).status, 401);
  assert.equal((await post('bm90LXRoZS1zaWduYXR1cmU=')).status, 401);
  const good = crypto.createHmac('sha256', 'line-test-secret').update(body).digest('base64');
  assert.equal((await post(good)).status, 200);
});

test('scanner push endpoint is disabled without ATTENDANCE_PUSH_TOKEN', async () => {
  const res = await fetch(`${base}/api/attendance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: '1001', status: 'in' }) });
  assert.equal(res.status, 404);
});

test('camera and location are allowed only on the mobile face page', async () => {
  const page = await fetch(`${base}/m/face`, { redirect: 'manual' });
  assert.match(page.headers.get('permissions-policy'), /camera=\(self\)/);
  const other = await fetch(`${base}/login`);
  assert.match(other.headers.get('permissions-policy'), /camera=\(\)/);
  const lib = await fetch(`${base}/vendor/human/human.esm.js`, { method: 'HEAD' });
  assert.equal(lib.status, 200);
  const model = await fetch(`${base}/vendor/human/models/blazeface.json`, { method: 'HEAD' });
  assert.equal(model.status, 200);
  const outside = await fetch(`${base}/vendor/human/models/../../package.json`);
  assert.notEqual(outside.status, 200);
});

test('own CSS/JS links carry a content hash so phones never keep stale styles', async () => {
  const html = await (await fetch(`${base}/login`)).text();
  const m = html.match(/href="\/css\/erp\.css\?v=([0-9a-f]{10})"/);
  assert.ok(m, 'erp.css link is versioned');
  const css = await fetch(`${base}/css/erp.css?v=${m[1]}`);
  assert.equal(css.status, 200);
});
