const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseProgressEventSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    unit_id: { type: Schema.Types.ObjectId, ref: 'CourseUnit', required: true },
    content_id: { type: Schema.Types.ObjectId, ref: 'CourseContent', required: true },
    event_type: { type: String, enum: ['video_completed', 'lesson_completed'], required: true },
    idempotency_key: { type: String, required: true, unique: true },
    source: { type: String, required: true, default: 'server' },
    event_time: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'course_progress_events',
  }
);

applyReferentialIntegrity(courseProgressEventSchema, [
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'student_id', ref: 'User', required: true },
  { path: 'unit_id', ref: 'CourseUnit', required: true },
  { path: 'content_id', ref: 'CourseContent', required: true },
]);

module.exports = mongoose.model('CourseProgressEvent', courseProgressEventSchema);
