const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseProgressEventSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Optional now: peer_assignment events are not necessarily linked to a unit.
    unit_id: { type: Schema.Types.ObjectId, ref: 'CourseUnit', default: null },

    // DEVIATION/SECURITY: Enforced validation — source_type determines which of the two fields is required,
    // instead of two separate tables, consistent with "simpler is always better" in Abstraction v2.0 §1.
    content_id: {
      type: Schema.Types.ObjectId,
      ref: 'CourseContent',
      default: null,
      validate: {
        validator: function (v) {
          return this.source_type === 'content' ? Boolean(v) : v === null;
        },
        message: 'content_id is required only when source_type = content.',
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
        message: 'session_id is required only when source_type = live_session.',
      },
    },
    peer_assignment_id: {
      type: Schema.Types.ObjectId,
      ref: 'PeerAssignment',
      default: null,
      validate: {
        validator: function (v) {
          return this.source_type === 'peer_assignment' ? Boolean(v) : v === null;
        },
        message: 'peer_assignment_id is required only when source_type = peer_assignment.',
      },
    },
    source_type: {
      type: String,
      enum: ['content', 'live_session', 'peer_assignment'],
      required: true,
      default: 'content', // Default maintains compatibility with old records.
    },

    event_type: {
      type: String,
      enum: [
        'video_completed',
        'lesson_completed',
        'live_session_attended',
        'peer_assignment_completed',
      ],
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
  { path: 'unit_id', ref: 'CourseUnit', required: false },
  { path: 'content_id', ref: 'CourseContent', required: false },
  { path: 'session_id', ref: 'LiveSession', required: false },
  { path: 'peer_assignment_id', ref: 'PeerAssignment', required: false },
]);

module.exports = mongoose.model('CourseProgressEvent', courseProgressEventSchema);
