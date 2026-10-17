const crypto = require('crypto');

let warned = false;

/** Keep the exact request bytes: LINE signs the raw body, not the re-serialised JSON. */
function captureRawBody(req, res, buf) {
  req.rawBody = buf;
}

function validSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('base64'));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * Rejects webhook calls that LINE did not sign with LINE_CHANNEL_SECRET, so nobody can post fake
 * events (spam, probing staff data, filling the logs). Without the secret configured the check is
 * skipped with a one-time warning, which keeps an unconfigured install working.
 */
function verifyLineSignature(req, res, next) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || secret.startsWith('your_')) {
    if (!warned) { console.warn('[LINE] LINE_CHANNEL_SECRET not set: webhook signatures are NOT verified'); warned = true; }
    return next();
  }
  if (!validSignature(req.rawBody, req.get('x-line-signature'), secret)) {
    return res.status(401).send('Invalid signature');
  }
  next();
}

module.exports = { captureRawBody, validSignature, verifyLineSignature };
