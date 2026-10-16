const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeAttachment, resolveAttachment } = require('../src/utils/attachments');

const b64 = buf => Buffer.from(buf).toString('base64');

test('accepts files whose content matches the declared type', () => {
  const pdf = decodeAttachment({ name: 'ใบรับรองแพทย์.pdf', type: 'application/pdf', data: b64('%PDF-1.4 test') });
  assert.equal(pdf.value.ext, 'pdf');
  const png = decodeAttachment({ name: 'a.png', type: 'image/png', data: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) });
  assert.equal(png.value.ext, 'png');
});

test('rejects spoofed, unsupported or oversized files', () => {
  assert.match(decodeAttachment({ name: 'x.pdf', type: 'application/pdf', data: b64('<html>') }).error, /ไม่ตรง/);
  assert.match(decodeAttachment({ name: 'x.exe', type: 'application/x-msdownload', data: b64('MZ') }).error, /รองรับ/);
  assert.match(decodeAttachment({ name: 'x.pdf', type: 'application/pdf', data: 'not base64!!' }).error, /เสียหาย/);
  const big = Buffer.alloc(4 * 1024 * 1024 + 1); big.write('%PDF');
  assert.match(decodeAttachment({ name: 'x.pdf', type: 'application/pdf', data: big.toString('base64') }).error, /ใหญ่เกิน/);
});

test('strips path characters from the original name', () => {
  const r = decodeAttachment({ name: '../../etc/passwd.pdf', type: 'application/pdf', data: b64('%PDF') });
  assert.ok(!r.value.name.includes('/'));
});

test('resolveAttachment refuses path traversal', () => {
  assert.equal(resolveAttachment('../app.js'), null);
  assert.equal(resolveAttachment('a/b.pdf'), null);
  assert.ok(resolveAttachment('123-abc.pdf').endsWith('123-abc.pdf'));
});
