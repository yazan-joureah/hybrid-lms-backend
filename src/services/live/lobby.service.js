// src/services/live/lobby.service.js
// UC-LIVE-05 — Lobby Control

const LiveLobbyRequest = require('../../models/liveLobbyRequest.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { assertInstructorOwnsSession } = require('./session.service');
const { getIO } = require('../../sockets/ioInstance');

/**
 * UC-LIVE-05 — يعرض للمحاضر قائمة الطلاب المنتظرين حالياً في غرفة الانتظار
 */
async function listLobbyRequests({ instructorId, sessionId, req }) {
  await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  const requests = await LiveLobbyRequest.find({ sessionId: safeSessionId, status: 'waiting' })
    .populate('studentId', 'full_name email')
    .sort({ createdAt: 1 })
    .lean();

  return { success: true, data: { requests } };
}

/**
 * UC-LIVE-05 — يقبل المحاضر طالباً واحداً من غرفة الانتظار
 */
async function admitParticipant({ instructorId, sessionId, studentId, req }) {
  await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const safeStudentId = toObjectId(studentId, 'studentId');

  const request = await LiveLobbyRequest.findOneAndUpdate(
    { sessionId: safeSessionId, studentId: safeStudentId },
    { status: 'admitted', decidedAt: new Date(), decidedByInstructorId: instructorId },
    { new: true }
  );

  if (!request) {
    throw new AppError(404, 'LOBBY_REQUEST_NOT_FOUND', 'لا يوجد طلب دخول لهذا الطالب.');
  }

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_LOBBY_PARTICIPANT_ADMITTED',
    resourceType: 'LiveSession',
    resourceId: safeSessionId.toString(),
    metadata: { studentId: safeStudentId.toString() },
    req,
  });

  // إشعار فوري للطالب المنتظر عبر Socket.IO كي يعيد طلب الانضمام مباشرة
  getIO()?.to(`live:${safeSessionId}:lobby:${safeStudentId}`).emit('lobby:admitted');

  return { success: true, data: { request } };
}

/**
 * UC-LIVE-05 — يقبل المحاضر كل الطلاب المنتظرين دفعة واحدة
 */
async function admitAllParticipants({ instructorId, sessionId, req }) {
  await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  const result = await LiveLobbyRequest.updateMany(
    { sessionId: safeSessionId, status: 'waiting' },
    { status: 'admitted', decidedAt: new Date(), decidedByInstructorId: instructorId }
  );

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_LOBBY_ALL_ADMITTED',
    resourceType: 'LiveSession',
    resourceId: safeSessionId.toString(),
    metadata: { admittedCount: result.modifiedCount },
    req,
  });

  getIO()?.to(`live:${safeSessionId}:lobby`).emit('lobby:admitted-all');

  return { success: true, data: { admittedCount: result.modifiedCount } };
}

/**
 * UC-LIVE-05 — يرفض المحاضر طلب دخول طالب
 */
async function denyParticipant({ instructorId, sessionId, studentId, req }) {
  await assertInstructorOwnsSession({ instructorId, sessionId, req });
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const safeStudentId = toObjectId(studentId, 'studentId');

  const request = await LiveLobbyRequest.findOneAndUpdate(
    { sessionId: safeSessionId, studentId: safeStudentId },
    { status: 'denied', decidedAt: new Date(), decidedByInstructorId: instructorId },
    { new: true }
  );

  if (!request) {
    throw new AppError(404, 'LOBBY_REQUEST_NOT_FOUND', 'لا يوجد طلب دخول لهذا الطالب.');
  }

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'LIVE_LOBBY_PARTICIPANT_DENIED',
    resourceType: 'LiveSession',
    resourceId: safeSessionId.toString(),
    metadata: { studentId: safeStudentId.toString() },
    req,
  });

  getIO()?.to(`live:${safeSessionId}:lobby:${safeStudentId}`).emit('lobby:denied');

  return { success: true, data: { request } };
}

module.exports = { listLobbyRequests, admitParticipant, admitAllParticipants, denyParticipant };
