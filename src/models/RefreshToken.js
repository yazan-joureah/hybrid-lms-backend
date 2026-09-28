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
