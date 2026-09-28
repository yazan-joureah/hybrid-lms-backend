const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
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
loginAttemptSchema.index({ attempted_at: -1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

applyReferentialIntegrity(loginAttemptSchema, [{ path: 'user_id', ref: 'User', required: false }]);

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);
