const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const mfaConfigurationSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    method: { type: String, enum: ['TOTP', 'EMAIL'], required: true },
    secret_encrypted: { type: String, default: null },
    enabled: { type: Boolean, required: true, default: false },
    verified_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'mfa_configurations',
  }
);

applyReferentialIntegrity(mfaConfigurationSchema, [
  { path: 'user_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('MFAConfiguration', mfaConfigurationSchema);
