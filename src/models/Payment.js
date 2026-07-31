// src/models/Payment.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const paymentSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'usd' },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      required: true,
      default: 'pending',
    },

    idempotency_key: { type: String, required: true, unique: true },
    gateway_session_id: { type: String, default: null },
    gateway_payment_intent_id: { type: String, default: null },
    failure_reason: { type: String, default: null },
    paid_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
);

applyReferentialIntegrity(paymentSchema, [
  { path: 'student_id', ref: 'User', required: true },
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'enrollment_id', ref: 'Enrollment', required: true },
]);

module.exports = mongoose.model('Payment', paymentSchema);
