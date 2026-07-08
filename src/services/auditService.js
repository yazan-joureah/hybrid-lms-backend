/**
 * Thin write-only wrapper around AuditLog (E12) — enforces Append-Only
 * discipline by exposing only `record()`. No update/delete function exists
 * by design (FR-30, OWASP A09).
 */
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

async function record({
  actorId = null,
  actorRole,
  action,
  resourceType,
  resourceId,
  metadata = null,
  req = null,
}) {
  try {
    await AuditLog.create({
      actor_id: actorId,
      actor_role: actorRole,
      action,
      resource_type: resourceType,
      resource_id: String(resourceId),
      metadata,
      ip_address: req?.ip || null,
      user_agent: req?.get?.('user-agent') || null,
    });
  } catch (err) {
    // Audit logging must never crash the primary request flow — log and continue.
    logger.error('Failed to write AuditLog entry', { error: err.message, action, resourceType });
  }
}

module.exports = { record };
