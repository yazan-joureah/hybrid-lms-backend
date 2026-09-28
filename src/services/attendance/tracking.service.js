// src/services/attendance/tracking.service.js

const Attendance = require('../../models/attendance.model');
const { AppError } = require('../../middleware/errorHandler');

const PRESENT_THRESHOLD_RATIO = 0.75;

async function recordAttendanceAutomatically({ studentId, sessionId, courseId }) {
  const existing = await Attendance.findOne({ sessionId, studentId });

  if (existing) {
    if (existing.leftAt) {
      existing.joinedAt = new Date();
      existing.leftAt = null;
      existing.durationSeconds = null;
      existing.status = 'preliminary';
      await existing.save();
      return { success: true, data: existing, resumed: true };
    }
    return { success: true, data: existing, resumed: false };
  }

  const record = await Attendance.create({
    sessionId,
    studentId,
    courseId,
    joinedAt: new Date(),
    status: 'preliminary',
    source: 'auto_join',
  });

  return { success: true, data: record, resumed: false };
}

async function recordAttendanceLeave({ studentId, sessionId, req }) {
  const record = await Attendance.findOne({ sessionId, studentId });
  if (!record) {
    throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'لا يوجد سجل حضور لهذا الطالب في هذه الجلسة.');
  }

  if (record.leftAt) {
    return { success: true, data: record };
  }

  const now = new Date();
  const durationSeconds = Math.max(0, Math.round((now - record.joinedAt) / 1000));

  record.leftAt = now;
  record.durationSeconds = durationSeconds;

  const LiveSession = require('../../models/liveSession.model');
  const session = await LiveSession.findById(sessionId)
    .select('startTime endTime unit_id courseId')
    .lean();

  if (session) {
    const sessionDurationSeconds = Math.max(
      1,
      Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000)
    );
    const ratio = durationSeconds / sessionDurationSeconds;
    record.status = ratio >= PRESENT_THRESHOLD_RATIO ? 'present' : 'partial';
  } else {
    record.status = 'present';
  }

  await record.save();

  if (session && record.status === 'present') {
    try {
      const { recordLiveSessionCompletion } = require('../progress.service');
      await recordLiveSessionCompletion({
        studentId,
        courseId: session.courseId,
        unitId: session.unit_id || null,
        sessionId,
        req,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- سيُستبدل بـ logger.js لاحقاً
      console.error('Live session progress recording failed (non-critical):', err.message);
    }
  }

  return { success: true, data: record };
}

async function finalizeSessionAttendance({ sessionId, req }) {
  const LiveSession = require('../../models/liveSession.model');
  const { recordLiveSessionCompletion } = require('../progress.service');

  const session = await LiveSession.findById(sessionId)
    .select('startTime endTime unit_id courseId')
    .lean();
  if (!session) return { closedCount: 0, endedEarly: false };

  const now = new Date();
  const scheduledStart = new Date(session.startTime);
  const scheduledEnd = new Date(session.endTime);
  const endedEarly = now < scheduledEnd;

  const effectiveDurationSeconds = endedEarly
    ? Math.max(1, Math.round((now - scheduledStart) / 1000))
    : Math.max(1, Math.round((scheduledEnd - scheduledStart) / 1000));

  const openRecords = await Attendance.find({ sessionId, leftAt: null });

  for (const record of openRecords) {
    const durationSeconds = Math.max(0, Math.round((now - record.joinedAt) / 1000));
    record.leftAt = now;
    record.durationSeconds = durationSeconds;

    const ratio = durationSeconds / effectiveDurationSeconds;
    record.status = ratio >= PRESENT_THRESHOLD_RATIO ? 'present' : 'partial';
    await record.save();

    try {
      await recordLiveSessionCompletion({
        studentId: record.studentId,
        courseId: session.courseId,
        unitId: session.unit_id || null,
        sessionId,
        req,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- سيُستبدل بـ logger.js لاحقاً
      console.error(
        'Live session progress recording failed on finalize (non-critical):',
        err.message
      );
    }
  }

  return { closedCount: openRecords.length, endedEarly };
}

module.exports = {
  recordAttendanceAutomatically,
  recordAttendanceLeave,
  finalizeSessionAttendance,
  PRESENT_THRESHOLD_RATIO,
};
