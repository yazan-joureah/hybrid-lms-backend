/**
 * E07 — ExternalIdentity
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Links a User to an external OAuth provider account. Designed to
 * support multiple providers in the future (enum includes MICROSOFT,
 * APPLE, GITHUB even though only GOOGLE is implemented now) — per the
 * spec's own forward-looking design note.
 */
const mongoose = require('mongoose');
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

// Compound UNIQUE — prevents the same external account (e.g. one Google
// account) from ever being linked to two different local Users
// simultaneously (MUC-AUTH-15, explicitly documented in the DB spec).
externalIdentitySchema.index({ provider: 1, provider_user_id: 1 }, { unique: true });
externalIdentitySchema.index({ user_id: 1 });

module.exports = mongoose.model('ExternalIdentity', externalIdentitySchema);
