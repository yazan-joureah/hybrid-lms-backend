/**
 * E06 — BackupCode
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Stored as an Argon2id hash (NOT SHA-256 like AuthToken/GuardianApproval)
 * — a deliberate distinction (DP-08 note in the spec itself): backup
 * codes are user-chosen-adjacent secrets a human might reuse/guess-adjacent
 * patterns for, closer in threat model to a password than to a
 * system-generated opaque token, so they get the slower, memory-hard
 * hash used for actual credentials.
 */
const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const backupCodeSchema = new Schema(
  {
    mfa_config_id: { type: Schema.Types.ObjectId, ref: 'MFAConfiguration', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // denormalized (DP-09) for direct lookup at login
    code_hash: { type: String, required: true },
    used: { type: Boolean, required: true, default: false },
    used_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'backup_codes',
  }
);

backupCodeSchema.index({ mfa_config_id: 1 });
backupCodeSchema.index({ mfa_config_id: 1, used: 1 });
backupCodeSchema.index({ user_id: 1, used: 1 });

applyReferentialIntegrity(backupCodeSchema, [
  { path: 'mfa_config_id', ref: 'MFAConfiguration', required: true },
  { path: 'user_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('BackupCode', backupCodeSchema);
