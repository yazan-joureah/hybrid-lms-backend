// src/services/report/securityAuditStats.service.js
// UC-REPORT-04 — View Security Audit Statistics (SuperAdmin only)
// SF-REPORT-02 — Aggregate Audit Log Metrics
//
// DEVIATION/SECURITY: deliberately data-driven, NOT a hardcoded list of
// "critical action names". Modules whose services weren't reviewed in
// this session (KYC/PAY/CERT/QUIZ/PEER/LIVE) already log rich
// security-relevant AuditLog events per their UC text (e.g.
// CSRF_ATTACK_DETECTED, WEBHOOK_SIGNATURE_INVALID), but hardcoding those
// exact strings without verifying them against the real service code
// risks silently-wrong filters that match nothing. Every aggregate below
// groups by whatever `action` values genuinely exist in the collection —
// correct today, and automatically stays correct as more modules ship.

const AuditLog = require('../../models/AuditLog');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90; // caps aggregation cost — no new infra/cron needed at this scale
const MAX_PAGE_SIZE = 50; // consistent with accountListing.service.js

function resolveRangeDays(days) {
  const parsed = Number(days) || DEFAULT_RANGE_DAYS;
  if (parsed < 1 || parsed > MAX_RANGE_DAYS) {
    throw new AppError(400, 'INVALID_RANGE', `days must be between 1 and ${MAX_RANGE_DAYS}.`);
  }
  return parsed;
}

function buildDailyBuckets(rangeDays) {
  // Pre-fills every day in the range with 0 so the line chart never has
  // gaps — the aggregation below only returns days that actually had events.
  const buckets = new Map();
  for (let i = 0; i < rangeDays; i += 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    buckets.set(key, 0);
  }
  return buckets;
}

/**
 * GET /admin/security-audit/overview?days=30 — UC-REPORT-04 main view.
 */
async function getSecurityAuditOverview({ actorId, actorRole, days, req }) {
  const rangeDays = resolveRangeDays(days);
  const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  const [totalEvents, accountLockoutsCount, actionBreakdown, dailyRaw, topActorsRaw] =
    await Promise.all([
      AuditLog.countDocuments({ created_at: { $gte: cutoff } }),

      // Confirmed real action name (session.service.js handleFailedLogin) —
      // the one KPI we DO call out explicitly since it's directly verified.
      AuditLog.countDocuments({ action: 'ACCOUNT_LOCKED', created_at: { $gte: cutoff } }),

      AuditLog.aggregate([
        { $match: { created_at: { $gte: cutoff } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
        { $project: { _id: 0, action: '$_id', count: 1 } },
      ]),

      AuditLog.aggregate([
        { $match: { created_at: { $gte: cutoff } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
      ]),

      AuditLog.aggregate([
        {
          $match: {
            created_at: { $gte: cutoff },
            actor_id: { $ne: null },
            actor_role: { $in: ['Admin', 'SuperAdmin'] },
          },
        },
        {
          $group: {
            _id: '$actor_id',
            actorRole: { $first: '$actor_role' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'actor',
          },
        },
        { $unwind: { path: '$actor', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            actorId: '$_id',
            actorRole: 1,
            count: 1,
            // full_name/email may be null if the actor was anonymized in
            // the meantime (fix/AUTH-BE-17 lazy sweep) — surfaced as-is,
            // never masked as an error here.
            fullName: '$actor.full_name',
            email: '$actor.email',
          },
        },
      ]),
    ]);

  // Merge the sparse daily aggregation into the pre-filled zero buckets.
  const buckets = buildDailyBuckets(rangeDays);
  dailyRaw.forEach(({ date, count }) => buckets.set(date, count));
  const dailyTimeline = Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));

  await auditService.record({
    actorId,
    actorRole,
    action: 'VIEW_SECURITY_AUDIT_STATS',
    resourceType: 'audit_log',
    resourceId: `range:${rangeDays}d`,
    metadata: { rangeDays },
    req,
  });

  return {
    error: null,
    rangeDays,
    totalEvents,
    accountLockoutsCount,
    actionBreakdown,
    dailyTimeline,
    topActors: topActorsRaw,
  };
}

/**
 * GET /admin/security-audit/events — drill-down / raw browsing, with
 * optional filters. Mirrors accountListing.service.js's pagination shape.
 */
async function listAuditEvents({
  action,
  actorId,
  actorRoleFilter,
  resourceType,
  page = 1,
  pageSize = 20,
}) {
  const filter = {};
  if (action) filter.action = action;
  if (actorRoleFilter) filter.actor_role = actorRoleFilter;
  if (resourceType) filter.resource_type = resourceType;
  if (actorId) filter.actor_id = toObjectId(actorId, 'actorId');

  const safePageSize = Math.min(Number(pageSize) || 20, MAX_PAGE_SIZE);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * safePageSize;

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actor_id', 'full_name email role')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(safePageSize)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { error: null, items, total, page: Number(page) || 1, pageSize: safePageSize };
}

/**
 * GET /admin/security-audit/actions — feeds a filter dropdown on the
 * frontend with every DISTINCT action name that genuinely exists, so the
 * UI never offers a filter option that silently returns zero rows.
 */
async function listDistinctActions() {
  const actions = await AuditLog.distinct('action');
  return { error: null, actions: actions.sort() };
}

module.exports = { getSecurityAuditOverview, listAuditEvents, listDistinctActions };
