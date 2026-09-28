// src/services/report/securityAuditStats.service.js

const AuditLog = require('../../models/AuditLog');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;
const MAX_PAGE_SIZE = 50;

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
 * GET /admin/security-audit/overview?days=30
 */
async function getSecurityAuditOverview({ actorId, actorRole, days, req }) {
  const rangeDays = resolveRangeDays(days);
  const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  const [totalEvents, accountLockoutsCount, actionBreakdown, dailyRaw, topActorsRaw] =
    await Promise.all([
      AuditLog.countDocuments({ created_at: { $gte: cutoff } }),

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
 * optional filters.
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
