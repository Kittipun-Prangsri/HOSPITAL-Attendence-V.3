const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } = require('../constants/leave');

// Stored outside /public so files are only reachable through the authenticated route
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'leave');

const SIGNATURES = {
  pdf: buf => buf.slice(0, 4).toString('latin1') === '%PDF',
  jpg: buf => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  png: buf => buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
};

/**
 * Validate an attachment sent as { name, type, data(base64) }.
 * The declared type must match the file's magic bytes. Returns { error } or { value: { buffer, ext, name, type } }.
 */
function decodeAttachment(input) {
  if (!input || typeof input !== 'object') return { error: 'ไฟล์แนบไม่ถูกต้อง' };
  const ext = ATTACHMENT_TYPES[input.type];
  if (!ext) return { error: 'รองรับเฉพาะไฟล์ PDF, JPG หรือ PNG' };
  if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) return { error: 'ไฟล์แนบเสียหาย' };
  const buffer = Buffer.from(input.data, 'base64');
  if (!buffer.length) return { error: 'ไฟล์แนบว่างเปล่า' };
  if (buffer.length > MAX_ATTACHMENT_BYTES) return { error: `ไฟล์ใหญ่เกิน ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` };
  if (!SIGNATURES[ext](buffer)) return { error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาไฟล์' };
  const name = String(input.name || `attachment.${ext}`).replace(/[\\/\0\r\n"]/g, '_').slice(0, 200);
  return { value: { buffer, ext, name, type: input.type } };
}

/** Write to disk under a random name; returns the stored relative file name. */
async function saveAttachment({ buffer, ext }) {
  await fs.promises.mkdir(UPLOAD_ROOT, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_ROOT, fileName), buffer, { flag: 'wx' });
  return fileName;
}

/** Absolute path for a stored name, refusing anything that escapes the upload folder. */
function resolveAttachment(fileName) {
  if (typeof fileName !== 'string' || !/^[\w.-]+$/.test(fileName)) return null;
  const full = path.join(UPLOAD_ROOT, fileName);
  return full.startsWith(UPLOAD_ROOT + path.sep) ? full : null;
}

async function removeAttachment(fileName) {
  const full = resolveAttachment(fileName);
  if (full) await fs.promises.unlink(full).catch(() => {});
}

module.exports = { decodeAttachment, saveAttachment, resolveAttachment, removeAttachment, UPLOAD_ROOT };
