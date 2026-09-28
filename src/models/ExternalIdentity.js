const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const externalIdentitySchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['GOOGLE', 'MICROSOFT', 'APPLE', 'GITHUB'], required: true },
    provider_user_id: { type: String, required: true },
    linked_at: { type: Date, required: true, default: Date.now },
    revoked_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'external_identities',
  }
);

externalIdentitySchema.index({ provider: 1, provider_user_id: 1 }, { unique: true });
externalIdentitySchema.index({ user_id: 1 });

applyReferentialIntegrity(externalIdentitySchema, [
  { path: 'user_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('ExternalIdentity', externalIdentitySchema);
