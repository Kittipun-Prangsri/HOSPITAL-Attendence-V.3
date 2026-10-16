const { pool } = require('../config/db');

const MAX_DETAIL = 4000;

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  return String((fwd && fwd.split(',')[0]) || req.ip || (req.socket && req.socket.remoteAddress) || '').slice(0, 64) || null;
}

/**
 * Record who did what. Never throws — auditing must not break the action being audited.
 * @param {object} req      Express request (session user + IP)
 * @param {string} action   e.g. 'create', 'update', 'delete', 'approve', 'login'
 * @param {string} entity   e.g. 'leave', 'user', 'settings'
 * @param {string|number} [entityId]
 * @param {object|string} [detail]  Small summary; never pass passwords or secrets
 * @param {object} [actorOverride]  For events without a session yet (login)
 */
async function logAudit(req, action, entity, entityId, detail, actorOverride) {
  try {
    const actor = actorOverride || (req.session && req.session.user) || {};
    let text = detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (text && text.length > MAX_DETAIL) text = text.slice(0, MAX_DETAIL) + '…';
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity, entity_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.username || null, actor.fullname || null, actor.role || null, action, entity,
        entityId == null ? null : String(entityId).slice(0, 100), text, clientIp(req)]
    );
  } catch (err) {
    console.warn('[audit] not recorded:', err.message);
  }
}

module.exports = { logAudit };
