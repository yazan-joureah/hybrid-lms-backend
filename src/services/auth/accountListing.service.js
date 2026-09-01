const User = require('../../models/User');
const AccountDeletionRequest = require('../../models/AccountDeletionRequest');
const auditService = require('../auditService');
const logger = require('../../utils/logger');

const MAX_PAGE_SIZE = 50;
const ANONYMIZATION_WINDOW_DAYS = 30; // matches the restore window — UC-AUTH-08.5 / GDPR Art.17

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET /admin/accounts?role=&status=&search=&page=&pageSize= */
async function listAccounts({ role, status, search, page = 1, pageSize = 20 }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { email: { $regex: safeSearch, $options: 'i' } },
      { full_name: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  const safePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const skip = (page - 1) * safePageSize;

  const [items, total] = await Promise.all([
    User.find(filter)
      .select('full_name email role status kyc_status mfa_enabled created_at deleted_at')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(safePageSize)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Lazy anonymization sweep — fire-and-forget, never await
  anonymizeExpiredDeletedAccounts({}).catch((err) => {
    logger.error('Lazy anonymization sweep failed (listAccounts)', { error: err.message });
  });

  return { error: null, items, total, page, pageSize: safePageSize };
}

/** GET /admin/deletion-requests?status=pending_review */
async function listDeletionRequests({ status = 'pending_review' }) {
  const requests = await AccountDeletionRequest.find({ status })
    .sort({ requested_at: 1 })
    .populate('user_id', 'full_name email role')
    .lean();

  // Lazy anonymization sweep — fire-and-forget, never await
  anonymizeExpiredDeletedAccounts({}).catch((err) => {
    logger.error('Lazy anonymization sweep failed (listDeletionRequests)', { error: err.message });
  });

  return { error: null, requests };
}

/**
 * DEVIATION (fix/AUTH-BE-17): Lazy Anonymization sweep — the same
 * opportunistic pattern already established in this codebase (CERT's
 * retryPendingIssuances() inside listMyCertificates). No cron/scheduled
 * job exists or is added; instead, every request an Admin/SuperAdmin
 * ALREADY makes to browse accounts (listAccounts) or the deletion queue
 * (listDeletionRequests) opportunistically sweeps any User past the
 * 30-day restore window that hasn't been anonymized yet.
 *
 * Uses the User.js compound index { deleted_at: 1, anonymized_at: 1 } —
 * which was already present in the schema for exactly this query shape,
 * suggesting this sweep was the intended design from the start.
 *
 * Only touches User identity fields. Payment/Invoice/Certificate records
 * are NEVER modified here — they keep their student_id reference intact
 * per the documented 5-year financial retention requirement
 * (UC-AUTH-08.5: "سجلات الدفع محفوظة 5 سنوات").
 *
 * Deliberately NOT awaited by callers (fire-and-forget + logged catch) —
 * a full collection sweep must never slow down or block an Admin's page
 * load. Trade-off accepted and documented: if no Admin visits either
 * listing endpoint for an extended period, anonymization is delayed
 * accordingly — acceptable for this project's scale; a real Cron/
 * scheduled job would be the only way to guarantee strict 30-day timing.
 */
async function anonymizeExpiredDeletedAccounts({ req } = {}) {
  const cutoff = new Date(Date.now() - ANONYMIZATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await User.find({
    deleted_at: { $lte: cutoff },
    anonymized_at: null,
  }).select('_id');

  if (candidates.length === 0) {
    return { anonymizedCount: 0 };
  }

  const ids = candidates.map((c) => c._id);

  await User.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        full_name: null,
        email: null,
        birth_date: null,
        profile_picture_storage_path: null,
        anonymized_at: new Date(),
      },
    }
  );

  await auditService.record({
    actorId: null,
    actorRole: 'System',
    action: 'ACCOUNTS_ANONYMIZED_LAZY_SWEEP',
    resourceType: 'user',
    resourceId: `batch:${ids.length}`,
    metadata: { count: ids.length, user_ids: ids.map(String) },
    req: req || null,
  });

  logger.info('Lazy anonymization sweep completed', { anonymizedCount: ids.length });

  return { anonymizedCount: ids.length };
}

module.exports = { listAccounts, listDeletionRequests, anonymizeExpiredDeletedAccounts };
