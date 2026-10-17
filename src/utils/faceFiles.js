const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Outside /public: face photos are only served through authenticated, role-checked routes
const ROOT = path.join(__dirname, '..', '..', 'uploads', 'face');
const MAX_BYTES = 2 * 1024 * 1024;

/** data URL or bare base64 JPEG → Buffer, or { error }. Only JPEG (what canvas.toBlob produces). */
function decodeJpeg(input) {
  if (typeof input !== 'string') return { error: 'ไม่พบภาพถ่าย' };
  const b64 = input.replace(/^data:image\/jpeg;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'ภาพถ่ายเสียหาย' };
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) return { error: 'ขนาดภาพต้องไม่เกิน 2 MB' };
  if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) return { error: 'รองรับเฉพาะภาพ JPEG' };
  return { value: buffer };
}

async function savePhoto(kind, buffer) {
  const dir = path.join(ROOT, kind);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
  return `${kind}/${name}`;
}

/** Absolute path for a stored "kind/name.jpg", refusing anything outside the folder. */
function photoPath(stored) {
  if (typeof stored !== 'string' || !/^(enroll|scan)\/[0-9]+-[0-9a-f]{24}\.jpg$/.test(stored)) return null;
  return path.join(ROOT, stored);
}

async function deletePhoto(stored) {
  const p = photoPath(stored);
  if (p) await fs.promises.unlink(p).catch(() => {});
}

module.exports = { decodeJpeg, savePhoto, photoPath, deletePhoto, MAX_BYTES };
