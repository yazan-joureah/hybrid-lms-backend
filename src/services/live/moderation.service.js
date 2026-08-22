// src/services/live/moderation.service.js
// UC-LIVE-07 — Moderation & Controls
//
// DEVIATION مهم: هذه الخدمة تُدير "حالة الإشراف" في قاعدة البيانات وتبثّها
// فورياً عبر Socket.IO — لكنها لا تتحكم فعلياً بميكروفون/كاميرا المتصفح.
// كتم الصوت الفعلي يحدث Client-side عند استقبال حدث `moderation:muted`
// (المتصفح يوقف مسار الصوت محلياً). هذا هو النمط القياسي لأي نظام بث لا
// يستضيف SFU/MCU خاصاً به (Jitsi/Zoom كطرف ثالث يستضيف الوسائط الفعلية).

const LiveSession = require('../../models/liveSession.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { assertInstructorOwnsSession } = require('./session.service');
const { getIO } = require('../../sockets/ioInstance');

async function muteParticipant({ instructorId, sessionId, studentId, req }) {
  const session = await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeStudentId = toObjectId(studentId, 'studentId');

  if (!session.mutedParticipantIds.some((id) => id.toString() === safeStudentId.toString())) {
    session.mutedParticipantIds.push(safeStudentId);
    await session.save();
  }

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_PARTICIPANT_MUTED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { studentId: safeStudentId.toString() },
    req,
  });

  getIO()?.to(`live:${session._id}`).emit('moderation:muted', { studentId: safeStudentId });
  return { success: true, data: { session } };
}

async function unmuteParticipant({ instructorId, sessionId, studentId, req }) {
  const session = await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeStudentId = toObjectId(studentId, 'studentId');

  session.mutedParticipantIds = session.mutedParticipantIds.filter(
    (id) => id.toString() !== safeStudentId.toString()
  );
  await session.save();

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_PARTICIPANT_UNMUTED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { studentId: safeStudentId.toString() },
    req,
  });

  getIO()?.to(`live:${session._id}`).emit('moderation:unmuted', { studentId: safeStudentId });
  return { success: true, data: { session } };
}

async function muteAllParticipants({ instructorId, sessionId, req }) {
  const session = await assertInstructorOwnsSession({ instructorId, sessionId, req });

  session.allMuted = true;
  await session.save();

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_ALL_PARTICIPANTS_MUTED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: {},
    req,
  });

  getIO()?.to(`live:${session._id}`).emit('moderation:mute-all');
  return { success: true, data: { session } };
}

async function removeParticipant({ instructorId, sessionId, studentId, req }) {
  const session = await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeStudentId = toObjectId(studentId, 'studentId');

  if (!session.removedParticipantIds.some((id) => id.toString() === safeStudentId.toString())) {
    session.removedParticipantIds.push(safeStudentId);
    await session.save();
  }

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_PARTICIPANT_REMOVED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { studentId: safeStudentId.toString() },
    req,
  });

  // إشعار الطالب المستهدف تحديداً كي يقطع Client اتصاله فوراً
  getIO()?.to(`live:${session._id}:user:${safeStudentId}`).emit('moderation:removed');
  getIO()
    ?.to(`live:${session._id}`)
    .emit('moderation:participant-removed', { studentId: safeStudentId });

  return { success: true, data: { session } };
}

async function toggleScreenShare({ userId, role, sessionId, isSharing, req }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const session = await LiveSession.findById(safeSessionId);
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  if (isSharing) {
    // فقط المحاضر، أو طالب رفع يده وسمح له المحاضر — للتبسيط في هذا التسليم:
    // المحاضر فقط يبدأ المشاركة؛ توسيع "سماح لطالب" لاحقاً عبر moderation إضافية.
    if (role !== 'Instructor' || session.instructorId.toString() !== userId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'فقط محاضر الجلسة يمكنه بدء مشاركة الشاشة.');
    }
    if (session.screenShareByUserId) {
      throw new AppError(409, 'SCREEN_SHARE_IN_PROGRESS', 'هناك مشاركة شاشة جارية بالفعل.');
    }
    session.screenShareByUserId = userId;
  } else {
    if (
      session.screenShareByUserId &&
      session.screenShareByUserId.toString() !== userId.toString() &&
      role !== 'Instructor'
    ) {
      throw new AppError(403, 'FORBIDDEN', 'لا يمكنك إيقاف مشاركة شاشة شخص آخر.');
    }
    session.screenShareByUserId = null;
  }

  await session.save();

  await auditService.record({
    actorId: userId,
    actorRole: role,
    action: isSharing ? 'LIVE_SCREEN_SHARE_STARTED' : 'LIVE_SCREEN_SHARE_STOPPED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: {},
    req,
  });

  getIO()
    ?.to(`live:${session._id}`)
    .emit('moderation:screen-share', {
      isSharing,
      userId: isSharing ? userId : null,
    });

  return { success: true, data: { session } };
}

module.exports = {
  muteParticipant,
  unmuteParticipant,
  muteAllParticipants,
  removeParticipant,
  toggleScreenShare,
};
