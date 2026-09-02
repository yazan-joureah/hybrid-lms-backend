// src/controllers/admin/securityAuditStats.controller.js
// UC-REPORT-04 — View Security Audit Statistics
const reportService = require('../../services/report/securityAuditStats.service');

/** GET /admin/security-audit/overview?days=30 */
async function getOverview(req, res, next) {
  try {
    const result = await reportService.getSecurityAuditOverview({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      days: req.query.days,
      req,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/** GET /admin/security-audit/events */
async function listEvents(req, res, next) {
  try {
    const { action, actorId, actorRole: actorRoleFilter, resourceType, page, pageSize } = req.query;
    const result = await reportService.listAuditEvents({
      action,
      actorId,
      actorRoleFilter,
      resourceType,
      page,
      pageSize,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/** GET /admin/security-audit/actions */
async function listActions(req, res, next) {
  try {
    const result = await reportService.listDistinctActions();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getOverview, listEvents, listActions };
