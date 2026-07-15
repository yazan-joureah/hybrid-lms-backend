/**
 * E03 — RefreshToken
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * NOT a JWT (see src/utils/jwt.js docstring) — an opaque random value,
 * persisted ONLY as its SHA-256 hash (DP-08), exactly like AuthToken.
 *
 * Critical security invariant (FR-03b — Session Revocation after
 * Password Reset): `token_version` here must match `User.token_version`
 * at verification time. Every successful Password Reset increments
 * User.token_version by 1, which instantly invalidates every RefreshToken
 * issued before that moment — without needing to enumerate and delete
 * them individually. This is the mechanism, not a side detail.
 */
const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    session_id: { type: Schema.Types.ObjectId, ref: 'Session', required: true },

    token_hash: { type: String, required: true, unique: true },
    token_version: { type: Number, required: true },

    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'refresh_tokens',
  }
);

refreshTokenSchema.index({ user_id: 1 });
refreshTokenSchema.index({ session_id: 1 });
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

applyReferentialIntegrity(refreshTokenSchema, [
  { path: 'user_id', ref: 'User', required: true },
  { path: 'session_id', ref: 'Session', required: true },
]);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
