/**
 * E02 — Session
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Represents ONE logged-in browser/device instance. A single User can
 * have multiple concurrent active Sessions (e.g. phone + laptop) — this
 * is why `mfa_verified` lives HERE and not on User: MFA is proven per
 * SESSION, not permanently on the account (UC-AUTH-05, FR-37). A device
 * that hasn't completed the second factor in ITS OWN session must not
 * silently inherit MFA-verified status from another device's session.
 */
const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    device_fingerprint: { type: String, required: true },
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true },

    mfa_verified: { type: Boolean, required: true, default: false },

    status: {
      type: String,
      enum: ['active', 'revoked', 'expired'],
      required: true,
      default: 'active',
    },

    last_activity_at: { type: Date, required: true, default: Date.now },
    expires_at: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'sessions',
  }
);

sessionSchema.index({ user_id: 1 });
sessionSchema.index({ status: 1 });
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

applyReferentialIntegrity(sessionSchema, [{ path: 'user_id', ref: 'User', required: true }]);

module.exports = mongoose.model('Session', sessionSchema);
