/**
 * E04 — AuthToken (Lean Domain Model)
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Unified entity for all transient tokens: email verification, password
 * reset, email OTP, and account restore. Only the SHA-256 hash is ever
 * persisted (DP-08) — the raw value exists only in the outbound email.
 */
const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const authTokenSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token_hash: { type: String, required: true, unique: true },
    token_type: {
      type: String,
      enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_OTP', 'ACCOUNT_RESTORE'],
      required: true,
    },
    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'auth_tokens',
  }
);

authTokenSchema.index({ user_id: 1, token_type: 1 });
authTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

applyReferentialIntegrity(authTokenSchema, [{ path: 'user_id', ref: 'User', required: true }]);

module.exports = mongoose.model('AuthToken', authTokenSchema);
