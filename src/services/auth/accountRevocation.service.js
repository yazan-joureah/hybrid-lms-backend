const User = require('../../models/User');
const Session = require('../../models/Session');
const RefreshToken = require('../../models/RefreshToken');
const ExternalIdentity = require('../../models/ExternalIdentity');
const auditService = require('../auditService');

//Invalidates every active JWT/RefreshToken/Session for one
//account, and locally severs any linked Google identity.
async function revokeAllSessionsAndOAuth({ userId, reason, triggeredByAdminId, req }) {
  const bumpResult = await User.updateOne({ _id: userId }, { $inc: { token_version: 1 } });

  if (bumpResult.matchedCount === 0) {
    return { error: 'USER_NOT_FOUND' };
  }

  await RefreshToken.updateMany(
    { user_id: userId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await Session.updateMany({ user_id: userId, status: 'active' }, { $set: { status: 'revoked' } });

  // No live Google OAuth revoke API call. googleOAuthLogin.js uses
  // access_type='online' and no Google access/refresh token is ever persisted
  // (Data Minimization by design) — there is no token to revoke via API.
  // Local revocation achieves the same security goal: oauth.service.js's
  // handleGoogleCallback only ever matches { revoked_at: null }, so this
  // account can no longer log in via that Google identity.
  await ExternalIdentity.updateMany(
    { user_id: userId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await auditService.record({
    actorId: userId,
    actorRole: 'System',
    action: 'ALL_SESSIONS_AND_OAUTH_REVOKED',
    resourceType: 'user',
    resourceId: userId,
    metadata: { reason, triggered_by_admin_id: triggeredByAdminId || null },
    req,
  });

  return { error: null };
}

module.exports = { revokeAllSessionsAndOAuth };
