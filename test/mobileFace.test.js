const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptTemplate, decryptTemplate, isConfigured } = require('../src/utils/faceCrypto');
const { validate, locate, distanceM } = require('../src/services/mobileScanSettings');
const { decodeJpeg, photoPath } = require('../src/utils/faceFiles');
const { safeReturnTo } = require('../src/middleware/auth');

test('face templates are encrypted with AES-GCM and only decrypt with the same key', () => {
  const saved = process.env.FACE_TEMPLATE_KEY;
  process.env.FACE_TEMPLATE_KEY = 'zz';
  assert.equal(isConfigured(), false);
  assert.throws(() => encryptTemplate([0.1]), /FACE_TEMPLATE_KEY/);
  process.env.FACE_TEMPLATE_KEY = 'a'.repeat(64);
  const emb = Array.from({ length: 1024 }, (_, i) => Math.sin(i));
  const enc = encryptTemplate(emb);
  assert.match(enc, /^v1:/);
  assert.notEqual(enc, encryptTemplate(emb), 'random IV each time');
  decryptTemplate(enc).forEach((v, i) => assert.ok(Math.abs(v - emb[i]) < 1e-6));
  const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => decryptTemplate(tampered));
  process.env.FACE_TEMPLATE_KEY = 'b'.repeat(64);
  assert.throws(() => decryptTemplate(enc), 'wrong key');
  if (saved === undefined) delete process.env.FACE_TEMPLATE_KEY; else process.env.FACE_TEMPLATE_KEY = saved;
});

test('mobile scan settings validation', () => {
  const site = { name: 'โรงพยาบาลคลองหาด', lat: 13.4, lng: 102.3, radiusM: 200 };
  assert.ok(validate({ enabled: false, sites: [], maxAccuracyM: 100, matchThreshold: 0.45, reviewThreshold: 0.35, photoRetentionDays: 90 }).value);
  assert.match(validate({ enabled: true, sites: [], maxAccuracyM: 100, matchThreshold: 0.45, reviewThreshold: 0.35, photoRetentionDays: 90 }).error, /อย่างน้อย 1 จุด/);
  assert.ok(validate({ enabled: true, sites: [site], maxAccuracyM: 100, matchThreshold: 0.45, reviewThreshold: 0.35, photoRetentionDays: 90 }).value);
  assert.ok(validate({ sites: [{ ...site, radiusM: 5 }], maxAccuracyM: 100, matchThreshold: 0.45, reviewThreshold: 0.35, photoRetentionDays: 90 }).error);
  assert.ok(validate({ sites: [], maxAccuracyM: 100, matchThreshold: 0.3, reviewThreshold: 0.4, photoRetentionDays: 90 }).error, 'review above match');
});

test('geofence: distance, radius and GPS accuracy', () => {
  const settings = { maxAccuracyM: 100, sites: [{ name: 'A', lat: 13.0, lng: 100.0, radiusM: 200 }, { name: 'B', lat: 13.1, lng: 100.0, radiusM: 200 }] };
  assert.ok(Math.abs(distanceM(13.0, 100.0, 13.001, 100.0) - 111.2) < 1);
  assert.deepEqual(locate(settings, 13.001, 100.0, 20), { site: 'A', distanceM: 111.2, radiusM: 200, inside: true });
  assert.equal(locate(settings, 13.001, 100.0, 500).inside, false, 'imprecise fix is not trusted');
  assert.equal(locate(settings, 13.099, 100.0, 20).site, 'B', 'nearest site');
  assert.equal(locate(settings, 13.05, 100.0, 20).inside, false);
  assert.equal(locate({ maxAccuracyM: 100, sites: [] }, 13, 100, 10).inside, false);
});

test('face photos: JPEG only, size-capped, no path escape', () => {
  assert.ok(decodeJpeg('data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64')).value);
  assert.ok(decodeJpeg(Buffer.from('%PDF-1.4').toString('base64')).error);
  assert.ok(decodeJpeg('not base64 !!').error);
  assert.ok(decodeJpeg(Buffer.alloc(3 * 1024 * 1024, 0xff).toString('base64')).error);
  assert.ok(photoPath('enroll/1700000000000-0123456789abcdef01234567.jpg'));
  assert.equal(photoPath('../../.env'), null);
  assert.equal(photoPath('enroll/../../x.jpg'), null);
});

test('post-login return path only allows same-site pages', () => {
  assert.equal(safeReturnTo('/m/face'), '/m/face');
  assert.equal(safeReturnTo('//evil.example'), null);
  assert.equal(safeReturnTo('https://evil.example'), null);
});

test('scan decision: liveness turn, face match, area', () => {
  const { decide } = require('../src/services/mobileScan');
  const settings = { matchThreshold: 0.45, reviewThreshold: 0.35 };
  const inside = { site: 'A', distanceM: 50, radiusM: 200, inside: true };
  const base = { settings, match: 0.8, sameFace: 0.6, frontYaw: 0.02, turnYaw: -0.4, action: 'left', place: inside };
  assert.deepEqual(decide(base), { status: 'accepted', reason: null });
  assert.equal(decide({ ...base, frontYaw: 0.4 }).status, 'rejected', 'first photo must look straight');
  assert.match(decide({ ...base, action: 'right' }).reason, /ขวา/, 'turned the wrong way');
  assert.equal(decide({ ...base, turnYaw: -0.1 }).status, 'rejected', 'barely turned');
  assert.equal(decide({ ...base, sameFace: 0.1 }).status, 'rejected', 'two different people');
  assert.equal(decide({ ...base, match: 0.2 }).status, 'rejected', 'not the enrolled face');
  assert.equal(decide({ ...base, match: 0.4 }).status, 'pending', 'borderline face goes to a person');
  const far = decide({ ...base, place: { site: 'A', distanceM: 900, radiusM: 200, inside: false } });
  assert.equal(far.status, 'pending');
  assert.match(far.reason, /นอกพื้นที่/);
  assert.match(decide({ ...base, place: { site: 'A', distanceM: 50, radiusM: 200, inside: false } }).reason, /GPS/);
  assert.equal(decide({ ...base, turnYaw: 0.4, action: 'right' }).status, 'accepted');
});

test('scan challenges are random, owned, single-use and expire', () => {
  const ms = require('../src/services/mobileScan');
  ms._resetChallenges();
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(ms.createChallenge(1, 'in').action);
  assert.deepEqual([...seen].sort(), ['left', 'right']);
  const c = ms.createChallenge(7, 'out');
  assert.equal(ms.takeChallenge(c.token, 8), null, 'someone else cannot use it');
  const d = ms.createChallenge(7, 'out');
  assert.equal(ms.takeChallenge(d.token, 7).direction, 'out');
  assert.equal(ms.takeChallenge(d.token, 7), null, 'second use refused');
  assert.equal(ms.takeChallenge('nope', 7), null);
});
