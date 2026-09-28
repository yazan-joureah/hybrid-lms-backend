const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const attendanceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveSession',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    joinedAt: {
      type: Date,
      required: true,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['preliminary', 'present', 'partial', 'absent'],
      default: 'preliminary',
    },
    source: {
      type: String,
      enum: ['auto_join', 'code', 'csv_import', 'manual'],
      default: 'auto_join',
    },
    correctionReason: {
      type: String,
      default: null,
      trim: true,
    },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    correctedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

applyReferentialIntegrity(attendanceSchema, [
  { path: 'sessionId', ref: 'LiveSession', required: true },
  { path: 'studentId', ref: 'User', required: true },
  { path: 'courseId', ref: 'Course', required: true },
  { path: 'correctedBy', ref: 'User', required: false },
]);

attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });
attendanceSchema.index({ courseId: 1, studentId: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
