const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const choiceSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    is_correct: { type: Boolean, required: true, default: false },
  },
  { _id: true }
);

// ---------------------------------------------------------------------------
// Question sub-schema.
// ---------------------------------------------------------------------------
const questionSchema = new Schema(
  {
    question_type: { type: String, enum: ['mcq', 'true_false'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    choices: {
      type: [choiceSchema],
      required: true,
      validate: {
        validator: function (choices) {
          if (!Array.isArray(choices) || choices.length < 2) return false;
          const correctCount = choices.filter((c) => c.is_correct).length;
          if (correctCount !== 1) return false;
          if (this.question_type === 'true_false' && choices.length !== 2) return false;
          return true;
        },
        message:
          'Each question needs at least 2 choices with exactly one marked correct; true_false questions must have exactly 2 choices.',
      },
    },
  },
  { _id: true }
);

const quizSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    unit_id: { type: Schema.Types.ObjectId, ref: 'CourseUnit', default: null },
    instructor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    quiz_type: { type: String, enum: ['quiz', 'exam'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '' },

    start_time: { type: Date, default: null },
    end_time: { type: Date, default: null },
    duration_minutes: { type: Number, required: true, min: 1 },
    passing_score_percent: { type: Number, required: true, min: 0, max: 100 },
    max_attempts: { type: Number, required: true, min: 1, default: 1 },
    allow_back_navigation: { type: Boolean },
    // --------------------------------------------------------------------

    questions: {
      type: [questionSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'A quiz must contain at least one question.',
      },
    },
    status: { type: String, enum: ['draft', 'published'], required: true, default: 'draft' },
    locked: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: true,
    collection: 'quizzes',
  }
);

quizSchema.pre('validate', function (next) {
  if (this.start_time && this.end_time && this.end_time <= this.start_time) {
    return next(new Error('end_time must be after start_time.'));
  }
  if (this.quiz_type === 'quiz' && !this.unit_id) {
    return next(new Error('unit_id is required when quiz_type is "quiz".'));
  }
  if (this.quiz_type === 'exam' && this.unit_id) {
    return next(
      new Error('unit_id must not be set when quiz_type is "exam" (course-wide final exam).')
    );
  }
  if (this.quiz_type === 'exam' && (!this.start_time || !this.end_time)) {
    return next(new Error('start_time and end_time are required for exam quizzes.'));
  }
  if (this.allow_back_navigation === undefined) {
    this.allow_back_navigation = this.quiz_type === 'quiz';
  }
  next();
});

quizSchema.index({ course_id: 1 });
quizSchema.index({ unit_id: 1 });
quizSchema.index({ instructor_id: 1 });

applyReferentialIntegrity(quizSchema, [
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'unit_id', ref: 'CourseUnit', required: false },
  { path: 'instructor_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('Quiz', quizSchema);
