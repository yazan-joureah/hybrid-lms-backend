const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const accountDeletionRequestSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected'],
      required: true,
      default: 'pending_review',
    },
    reason: { type: String, required: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decision_reason: { type: String, default: null },
    requested_at: { type: Date, required: true, default: Date.now },
    reviewed_at: { type: Date, default: null },
  },
  {
    timestamps: false,
    collection: 'account_deletion_requests',
  }
);

applyReferentialIntegrity(accountDeletionRequestSchema, [
  { path: 'user_id', ref: 'User', required: true },
  { path: 'reviewer_id', ref: 'User', required: false },
]);

accountDeletionRequestSchema.index({ user_id: 1 });
accountDeletionRequestSchema.index({ status: 1 });
accountDeletionRequestSchema.index({ requested_at: -1 });

module.exports = mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);
