const crypto = require('crypto');

/**
 * Face templates are biometric data (PDPA s.26): stored only encrypted with AES-256-GCM.
 * FACE_TEMPLATE_KEY = 64 hex chars (32 bytes), e.g.
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Losing the key means everyone has to enrol again; never commit it.
 */
function keyFromEnv() {
  const hex = (process.env.FACE_TEMPLATE_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

const isConfigured = () => keyFromEnv() !== null;

/** number[] → "v1:<iv>:<tag>:<ciphertext>" (base64 parts). Float32 keeps it compact. */
function encryptTemplate(embedding) {
  const key = keyFromEnv();
  if (!key) throw new Error('FACE_TEMPLATE_KEY is not configured');
  const plain = Buffer.from(new Float32Array(embedding).buffer);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decryptTemplate(stored) {
  const key = keyFromEnv();
  if (!key) throw new Error('FACE_TEMPLATE_KEY is not configured');
  const [version, iv, tag, data] = String(stored || '').split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown template format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return Array.from(new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4));
}

module.exports = { encryptTemplate, decryptTemplate, isConfigured };
