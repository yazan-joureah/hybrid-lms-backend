const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseProgressEventSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    unit_id: { type: Schema.Types.ObjectId, ref: 'CourseUnit', required: true },

    // DEVIATION/SECURITY: تحقق مطّبق — source_type يحدد أي حقل من الاثنين مطلوب،
    // بدل جدولين منفصلين، اتساقًا مع "الأبسط دائمًا" في Abstraction v2.0 §1
    content_id: {
      type: Schema.Types.ObjectId,
      ref: 'CourseContent',
      default: null,
      validate: {
        validator: function (v) {
          return this.source_type === 'content' ? Boolean(v) : v === null;
        },
        message: 'content_id مطلوب فقط عندما source_type = content.',
      },
    },
    session_id: {
      type: Schema.Types.ObjectId,
      ref: 'LiveSession',
      default: null,
      validate: {
        validator: function (v) {
          return this.source_type === 'live_session' ? Boolean(v) : v === null;
        },
        message: 'session_id مطلوب فقط عندما source_type = live_session.',
      },
    },
    source_type: {
      type: String,
      enum: ['content', 'live_session'],
      required: true,
      default: 'content', // القيمة الافتراضية تحافظ على توافق السجلات القديمة
    },

    event_type: {
      type: String,
      enum: ['video_completed', 'lesson_completed', 'live_session_attended'],
      required: true,
    },
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
  { path: 'content_id', ref: 'CourseContent', required: false },
  { path: 'session_id', ref: 'LiveSession', required: false },
]);

module.exports = mongoose.model('CourseProgressEvent', courseProgressEventSchema);
