// src/models/RefundRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const refundRequestSchema = new Schema(
  {
    payment_id: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['review_pending', 'approved', 'rejected'],
      required: true,
      default: 'review_pending',
    },
    idempotency_key: { type: String, required: true, unique: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decision_reason: { type: String, default: null },
    reviewed_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'refund_requests',
  }
);

applyReferentialIntegrity(refundRequestSchema, [
  { path: 'payment_id', ref: 'Payment', required: true },
  { path: 'student_id', ref: 'User', required: true },
  { path: 'reviewer_id', ref: 'User', required: false },
]);

module.exports = mongoose.model('RefundRequest', refundRequestSchema);
