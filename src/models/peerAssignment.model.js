/* ==========================================================================
   src/models/peerAssignment.model.js
   UC-PEER-01 — Create Peer Assessment Task
   ========================================================================== */

const mongoose = require('mongoose');

const rubricCriterionSchema = new mongoose.Schema(
  {
    criterion: { type: String, required: true, trim: true, maxlength: 200 },
    maxScore: { type: Number, required: true, min: 1 },
    weight: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const peerAssignmentSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CourseUnit',
      default: null,
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    rubric: {
      type: [rubricCriterionSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one rubric criterion must be added.',
      },
    },
    submissionDeadline: { type: Date, required: false, default: null },
    reviewDeadline: { type: Date, required: false, default: null },
    reviewersPerSubmission: { type: Number, required: true, default: 2, min: 1 },
    allowFileSubmission: { type: Boolean, default: true },
    maxAttempts: { type: Number, default: 3, min: 1, max: 5 },
    status: {
      type: String,
      enum: ['open', 'distributing', 'distributed', 'completed'],
      default: 'open',
    },
    distributedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

peerAssignmentSchema.pre('validate', function (next) {
  if (this.reviewDeadline && !this.submissionDeadline) {
    return next(new Error('reviewDeadline requires submissionDeadline to be set.'));
  }
  if (
    this.submissionDeadline &&
    this.reviewDeadline &&
    this.reviewDeadline <= this.submissionDeadline
  ) {
    return next(new Error('reviewDeadline must be after submissionDeadline.'));
  }
  next();
});

peerAssignmentSchema.index({ courseId: 1, submissionDeadline: 1 });
peerAssignmentSchema.index({ status: 1, submissionDeadline: 1 });
peerAssignmentSchema.index({ status: 1, reviewDeadline: 1 });

module.exports = mongoose.model('PeerAssignment', peerAssignmentSchema);
