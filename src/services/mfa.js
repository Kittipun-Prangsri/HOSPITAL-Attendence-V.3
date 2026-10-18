/**
 * Two-step sign-in for admin / super accounts (and anyone who turns on an authenticator).
 *   - Authenticator app: TOTP (RFC 6238, SHA-1, 6 digits, 30 s), secret encrypted at rest
 *   - Telegram: 6-digit code to the linked chat, valid 5 minutes (kept in the pending session)
 *   - 8 one-time recovery codes (only SHA-256 hashes stored)
 * LINE is deliberately not used: its free push quota can run out and lock admins out.
 * ADMIN_MFA=off disables enforcement in an emergency.
 */
const crypto = require('crypto');
const { pool } = require('../config/db');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const lastStep = new Map(); // personId → last accepted step (blocks replay of the same code)

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP/TOTP code for a raw key at a given step (exported for the RFC test vectors). */
function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);

/** Accepts the current step ±1 (clock drift). Resolves to the matched step or null. */
function checkTotp(secretB32, code, ms = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(ms);
  for (const s of [now, now - 1, now + 1]) {
    const a = Buffer.from(hotp(key, s)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}

/* ---- encryption of the TOTP secret (key derived from SESSION_SECRET) ---- */
const encKey = () => crypto.hkdfSync('sha256', String(process.env.SESSION_SECRET || ''), 'khh-hrm', 'mfa-totp-secret', 32);
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(encKey()), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function open(sealed) {
  const [v, iv, tag, data] = String(sealed || '').split(':');
  if (v !== 'v1') throw new Error('bad secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey()), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

const hashCode = code => crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');

async function row(personId) {
  const [[r]] = await pool.query('SELECT * FROM account_mfa WHERE hr_person_id = ?', [personId]).catch(() => [[null]]);
  return r || null;
}

/** Is two-step sign-in required for this login? Admin roles always; others once they enabled an authenticator. */
function enforcedFor(role) {
  return (process.env.ADMIN_MFA || 'on').toLowerCase() !== 'off' && (role === 'admin' || role === 'super');
}

/** { totp, telegram, recoveryLeft } */
async function status(personId) {
  const r = await row(personId);
  const { linkOf } = require('./messagingLinks');
  const links = await linkOf(personId);
  let recoveryLeft = 0;
  try { recoveryLeft = r && r.recovery_hashes ? JSON.parse(r.recovery_hashes).length : 0; } catch (e) { recoveryLeft = 0; }
  return { totp: Boolean(r && r.totp_secret && r.totp_enabled_at), telegram: Boolean(links.telegram), recoveryLeft };
}

async function beginTotpSetup(personId, label) {
  const secret = base32Encode(crypto.randomBytes(20));
  await pool.query(
    `INSERT INTO account_mfa (hr_person_id, pending_secret) VALUES (?, ?) ON DUPLICATE KEY UPDATE pending_secret = VALUES(pending_secret)`,
    [personId, seal(secret)]);
  const issuer = 'KHH HRM';
  const otpauth = `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
  const qr = await require('qrcode').toDataURL(otpauth, { margin: 1, width: 240 });
  return { secret, otpauth, qr };
}

/** Confirm the pending secret with a code; enables it and returns fresh recovery codes. */
async function confirmTotp(personId, code) {
  const r = await row(personId);
  if (!r || !r.pending_secret) return { error: 'กรุณาเริ่มตั้งค่าใหม่' };
  const secret = open(r.pending_secret);
  const step = checkTotp(secret, code);
  if (step === null) return { error: 'รหัสไม่ถูกต้อง ตรวจเวลาในโทรศัพท์ให้ตรงแล้วลองใหม่' };
  lastStep.set(String(personId), step);
  const codes = newRecoveryCodes();
  await pool.query(
    'UPDATE account_mfa SET totp_secret = pending_secret, pending_secret = NULL, totp_enabled_at = NOW(), recovery_hashes = ? WHERE hr_person_id = ?',
    [JSON.stringify(codes.map(hashCode)), personId]);
  return { codes };
}

function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function regenerateRecovery(personId) {
  const codes = newRecoveryCodes();
  await pool.query('UPDATE account_mfa SET recovery_hashes = ? WHERE hr_person_id = ?', [JSON.stringify(codes.map(hashCode)), personId]);
  return codes;
}

async function disableTotp(personId) {
  await pool.query('UPDATE account_mfa SET totp_secret = NULL, totp_enabled_at = NULL, pending_secret = NULL, recovery_hashes = NULL WHERE hr_person_id = ?', [personId]);
  lastStep.delete(String(personId));
}

/** Verify an authenticator code against the enabled secret (no replay of an already used step). */
async function verifyTotpFor(personId, code) {
  const r = await row(personId);
  if (!r || !r.totp_secret) return false;
  const step = checkTotp(open(r.totp_secret), code);
  if (step === null || step <= (lastStep.get(String(personId)) ?? -1)) return false;
  lastStep.set(String(personId), step);
  return true;
}

/** Use (and burn) a recovery code. */
async function useRecovery(personId, code) {
  const r = await row(personId);
  if (!r || !r.recovery_hashes) return false;
  const list = JSON.parse(r.recovery_hashes);
  const h = hashCode(code);
  if (!list.includes(h)) return false;
  await pool.query('UPDATE account_mfa SET recovery_hashes = ? WHERE hr_person_id = ?', [JSON.stringify(list.filter(x => x !== h)), personId]);
  return true;
}

/** 6-digit Telegram code: { code, hash, exp } (the hash goes into the pending session). */
function newTelegramCode() {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return { code, hash: hashCode(code), exp: Date.now() + 5 * 60 * 1000 };
}

const setupCache = new Map(); // personId → { at, needs }
/** Admin roles must have a second factor; cached a minute (cleared whenever a factor changes). */
async function needsSetup(user) {
  if (!user || !enforcedFor(user.role)) return false;
  const hit = setupCache.get(String(user.id));
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.needs;
  const st = await status(user.id);
  const needs = !st.totp && !st.telegram;
  setupCache.set(String(user.id), { at: Date.now(), needs });
  return needs;
}
const clearSetupCache = personId => setupCache.delete(String(personId));

module.exports = {
  needsSetup, clearSetupCache,
  base32Encode, base32Decode, hotp, checkTotp, enforcedFor, status, beginTotpSetup, confirmTotp,
  regenerateRecovery, disableTotp, verifyTotpFor, useRecovery, newTelegramCode, hashCode, _lastStep: lastStep
};
