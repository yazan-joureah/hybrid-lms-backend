/**
 * E11 — LoginAttempt
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Deliberately SEPARATE from AuditLog: this exists specifically to record
 * attempts against emails that DON'T belong to any real account
 * (`user_id: null`) — something AuditLog (which always implies a
 * meaningful actor/resource pair) is not designed for. This is what lets
 * us later detect systematic User Enumeration probing (many distinct
 * `email_entered` values from one IP) without polluting the security
 * audit trail with noise from non-existent accounts.
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const loginAttemptSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    email_entered: { type: String, required: true },
    attempt_type: { type: String, enum: ['LOGIN', 'REGISTRATION', 'OTP_REQUEST'], required: true },
    success: { type: Boolean, required: true },
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true },
  },
  {
    timestamps: { createdAt: 'attempted_at', updatedAt: false },
    collection: 'login_attempts',
  }
);

loginAttemptSchema.index({ email_entered: 1 });
loginAttemptSchema.index({ ip_address: 1 });
loginAttemptSchema.index({ attempted_at: -1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30-day TTL per DB spec

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);
