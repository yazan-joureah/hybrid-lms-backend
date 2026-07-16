const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const enrollmentSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'active', 'cancelled', 'completed'],
      required: true,
    },
    payment_id: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    confirmed_by_student: { type: Boolean, required: true },
    enrolled_at: { type: Date, required: true, default: Date.now },
    activated_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
  },
  {
    timestamps: false,
    collection: 'enrollments',
  }
);

applyReferentialIntegrity(enrollmentSchema, [
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'student_id', ref: 'User', required: true },
  { path: 'payment_id', ref: 'Payment', required: false },
]);

module.exports = mongoose.model('Enrollment', enrollmentSchema);
