// Boots the real Express app (memory sessions, no DB queries on these paths) and checks the
// security behaviour end-to-end over HTTP.
process.env.SESSION_STORE = 'memory';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
// Never reach real infrastructure from tests (dotenv does not override variables already set)
for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_ADMIN_USER_ID', 'GOOGLE_SHEET_URL']) process.env[key] = '';
process.env.DB_HOST = '127.0.0.1';

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
