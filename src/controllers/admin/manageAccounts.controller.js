// src/controllers/admin/manageAccounts.controller.js
const authService = require('../../services/authService');

/** GET /admin/accounts — UC-AUTH-08, browsing/search (closes the listing gap). */
async function listAccountsHandler(req, res, next) {
  try {
    const { role, status, search, page, pageSize } = req.query;
    const result = await authService.listAccounts({
      role,
      status,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /admin/accounts/:id/status — UC-AUTH-08.1 + 08.2. */
async function setAccountStatusHandler(req, res, next) {
  try {
    const result = await authService.setAccountStatus({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      targetUserId: req.params.id,
      action: req.validatedBody.action,
      reason: req.validatedBody.reason,
      req,
    });
    return res.status(200).json({ success: true, data: { status: result.status } });
  } catch (err) {
    return next(err);
  }
}

/** POST /admin/accounts — UC-AUTH-08.3. SuperAdmin-only (route-level requireRole). */
async function createAdminAccountHandler(req, res, next) {
  try {
    const result = await authService.createAdminAccount({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      email: req.validatedBody.email,
      fullName: req.validatedBody.fullName,
      req,
    });
    return res.status(201).json({
      success: true,
      data: { adminId: result.adminId, email: req.validatedBody.email },
    });
  } catch (err) {
    return next(err);
  }
}

/** DELETE /admin/accounts/:id — UC-AUTH-08.4 + 08.5. */
async function deleteAccountHandler(req, res, next) {
  try {
    const result = await authService.deleteAccount({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      targetUserId: req.params.id,
      reason: req.validatedBody.reason,
      req,
    });
    return res.status(200).json({
      success: true,
      data: { status: result.status, restoreWindowDays: result.restoreWindowDays },
    });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /admin/accounts/:id/deletion — admin-triggered restore (closes gap #1). */
async function adminRestoreAccountHandler(req, res, next) {
  try {
    const result = await authService.adminRestoreAccount({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      targetUserId: req.params.id,
      req,
    });
    return res.status(200).json({ success: true, data: { status: result.status } });
  } catch (err) {
    return next(err);
  }
}

/** GET /admin/deletion-requests — SuperAdmin review queue (closes gap #2). */
async function listDeletionRequestsHandler(req, res, next) {
  try {
    const { status } = req.query;
    const result = await authService.listDeletionRequests({ status });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/** POST /admin/deletion-requests/:id/review — SuperAdmin decision on UC-AUTH-08.6. */
async function reviewDeletionRequestHandler(req, res, next) {
  try {
    const result = await authService.reviewDeletionRequest({
      reviewerId: req.user.id,
      requestId: req.params.id,
      decision: req.validatedBody.decision,
      decisionReason: req.validatedBody.decisionReason,
      req,
    });
    return res.status(200).json({ success: true, data: { status: result.status } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listAccountsHandler,
  setAccountStatusHandler,
  createAdminAccountHandler,
  deleteAccountHandler,
  adminRestoreAccountHandler,
  listDeletionRequestsHandler,
  reviewDeletionRequestHandler,
};
