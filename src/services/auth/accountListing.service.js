const User = require('../../models/User');
const AccountDeletionRequest = require('../../models/AccountDeletionRequest');

const MAX_PAGE_SIZE = 50;

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

  return { error: null, items, total, page, pageSize: safePageSize };
}

/** GET /admin/deletion-requests?status=pending_review */
async function listDeletionRequests({ status = 'pending_review' }) {
  const requests = await AccountDeletionRequest.find({ status })
    .sort({ requested_at: 1 })
    .populate('user_id', 'full_name email role')
    .lean();

  return { error: null, requests };
}

module.exports = { listAccounts, listDeletionRequests };
