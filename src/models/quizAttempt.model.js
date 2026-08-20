const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const shuffledQuestionSchema = new Schema(
  {
    question_id: { type: Schema.Types.ObjectId, required: true },
    shuffled_choice_ids: [{ type: Schema.Types.ObjectId, required: true }],
  },
  { _id: false }
);

const answerSchema = new Schema(
  {
    question_id: { type: Schema.Types.ObjectId, required: true },
    selected_choice_id: { type: Schema.Types.ObjectId, required: true },
    answered_at: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const quizAttemptSchema = new Schema(
  {
    quiz_id: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    attempt_number: { type: Number, required: true, min: 1 },

    shuffled_question_order: {
      type: [shuffledQuestionSchema],
      required: true,
    },
    answers: {
      type: [answerSchema],
      default: [],
    },

    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'graded'],
      required: true,
      default: 'in_progress',
    },

    started_at: { type: Date, required: true, default: Date.now },

    expires_at: { type: Date, required: true },

    submitted_at: { type: Date, default: null },
    submitted_by: { type: String, enum: ['student', 'system_timeout'], default: null },

    score_percent: { type: Number, default: null, min: 0, max: 100 },
    passed: { type: Boolean, default: null },
    graded_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'quiz_attempts',
  }
);

quizAttemptSchema.index(
  { quiz_id: 1, student_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'in_progress' },
  }
);

quizAttemptSchema.index({ quiz_id: 1, student_id: 1 });
quizAttemptSchema.index({ status: 1, expires_at: 1 });

applyReferentialIntegrity(quizAttemptSchema, [
  { path: 'quiz_id', ref: 'Quiz', required: true },
  { path: 'student_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
