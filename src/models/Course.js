const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseSchema = new Schema(
  {
    owner_instructor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: [
        'Technology & Computer Science',
        'Business & Finance',
        'Health, Medicine & Wellness',
        'Arts, Design & Creative',
        'Mathematics, Science & Engineering',
        'Humanities & Social Sciences',
        'Languages',
        'Personal Development & Lifestyle',
      ],
      required: true,
    },
    course_type: { type: String, enum: ['free', 'paid'], required: true },
    price: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'published', 'rejected', 'suspended', 'archived'],
      required: true,
    },
    is_synchronous: { type: Boolean, required: true, default: false },
    max_students: { type: Number, default: null },
    content_complete: { type: Boolean, required: true, default: false },
    completion_threshold: { type: Number, required: true, default: 0.7, min: 0.0, max: 1.0 },
    prerequisite_course_ids: [{ type: Schema.Types.ObjectId, ref: 'Course' }],
    rejection_reason: { type: String, default: null },
    published_at: { type: Date, default: null },
    suspended_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'courses',
  }
);

// Enforce integrity rules
applyReferentialIntegrity(courseSchema, [
  { path: 'owner_instructor_id', ref: 'User', required: true },
  { path: 'suspended_by', ref: 'User', required: false },
  { path: 'prerequisite_course_ids', ref: 'Course', required: false },
]);

module.exports = mongoose.model('Course', courseSchema);
