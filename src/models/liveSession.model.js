const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const liveSessionSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CourseUnit',
      default: null,
      index: true,
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    meetingLink: {
      type: String,
      required: true,
    },
    moderatorPassword: {
      type: String,
      select: false,
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'ended', 'cancelled'],
      required: true,
      default: 'scheduled',
    },
    cancelReason: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },

    lobbyEnabled: {
      type: Boolean,
      default: false,
    },

    studentsAllowed: {
      type: Boolean,
      default: false,
    },

    mutedParticipantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    allMuted: {
      type: Boolean,
      default: false,
    },
    screenShareByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    removedParticipantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    recordingStatus: {
      type: String,
      enum: ['none', 'processing', 'ready', 'failed'],
      default: 'none',
    },
    recordingUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

applyReferentialIntegrity(liveSessionSchema, [
  { path: 'courseId', ref: 'Course', required: true },
  { path: 'unit_id', ref: 'CourseUnit', required: false },
  { path: 'instructorId', ref: 'User', required: true },
]);

liveSessionSchema.index({ courseId: 1, startTime: 1 });
liveSessionSchema.index({ instructorId: 1, startTime: 1 });
liveSessionSchema.index({ status: 1, startTime: 1 });
liveSessionSchema.index({ courseId: 1, unit_id: 1 });

module.exports = mongoose.model('LiveSession', liveSessionSchema);
