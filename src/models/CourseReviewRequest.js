const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseReviewRequestSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    requested_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected', 'needs_revision'],
      required: true,
    },
    changes_snapshot: { type: Schema.Types.Mixed, required: true },
    rejection_reason: { type: String, default: null },
    reviewed_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'course_review_requests',
  }
);

applyReferentialIntegrity(courseReviewRequestSchema, [
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'requested_by', ref: 'User', required: true },
  { path: 'reviewer_id', ref: 'User', required: false },
]);

module.exports = mongoose.model('CourseReviewRequest', courseReviewRequestSchema);
