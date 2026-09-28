const mongoose = require('mongoose');

const rubricScoreSchema = new mongoose.Schema(
  {
    criterion: { type: String, required: true, trim: true },
    score: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const peerReviewSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PeerAssignment',
      required: true,
      index: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PeerSubmission',
      required: true,
      index: true,
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    scores: { type: [rubricScoreSchema], default: [] },
    feedbackText: { type: String, trim: true, maxlength: 5000, default: null },
    totalScore: { type: Number, default: null },
    attemptNumber: { type: Number, default: 1, min: 1 },

    status: { type: String, enum: ['assigned', 'completed'], default: 'assigned' },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

peerReviewSchema.index({ submissionId: 1, reviewerId: 1, attemptNumber: 1 }, { unique: true });
peerReviewSchema.index({ assignmentId: 1, reviewerId: 1 });
peerReviewSchema.index({ submissionId: 1, attemptNumber: 1 });

module.exports = mongoose.model('PeerReview', peerReviewSchema);
