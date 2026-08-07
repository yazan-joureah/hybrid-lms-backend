// src/services/live/chat.service.js
// UC-LIVE-06 — In-Stream Chat & Q&A

const LiveChatMessage = require('../../models/liveChatMessage.model');
const LiveSession = require('../../models/liveSession.model');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { getIO } = require('../../sockets/ioInstance');

/**
 * يتحقق أن المستخدم (طالب أو محاضر) مسموح له بالوصول لدردشة هذه الجلسة —
 * محاضر مالك الجلسة، أو طالب مسجَّل فعلياً بكورسها.
 */
async function assertCanAccessSessionChat({ userId, role, sessionId }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const session = await LiveSession.findById(safeSessionId).lean();
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  if (role === 'Instructor') {
    if (session.instructorId.toString() !== userId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية الوصول لدردشة هذه الجلسة.');
    }
    return session;
  }

  const enrolled = await Enrollment.findOne({
    student_id: userId,
    course_id: session.courseId,
    status: 'active',
  }).lean();
  if (!enrolled) {
    throw new AppError(403, 'FORBIDDEN', 'غير مسجل في كورس هذه الجلسة.');
  }
  return session;
}

/**
 * UC-LIVE-06 — إرسال رسالة (نص، أو رفع/خفض يد)
 */
async function sendChatMessage({ userId, role, sessionId, messageType = 'text', text, req: _req }) {
  await assertCanAccessSessionChat({ userId, role, sessionId });
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  if (messageType === 'text' && (!text || !text.trim())) {
    throw new AppError(400, 'EMPTY_MESSAGE', 'لا يمكن إرسال رسالة فارغة.');
  }

  const message = await LiveChatMessage.create({
    sessionId: safeSessionId,
    senderId: userId,
    senderRole: role,
    messageType,
    text: messageType === 'text' ? text.trim() : null,
  });

  // بث فوري لكل المشاركين المتصلين حالياً بهذه الجلسة (تكامل مع liveSocket.js)
  getIO()?.to(`live:${safeSessionId}`).emit('chat:new-message', {
    _id: message._id,
    senderId: message.senderId,
    senderRole: message.senderRole,
    messageType: message.messageType,
    text: message.text,
    createdAt: message.createdAt,
  });

  return { success: true, data: { message } };
}

/**
 * UC-LIVE-06 — جلب سجل الدردشة (Pagination بسيط)
 */
async function getChatMessages({ userId, role, sessionId, queryParams = {} }) {
  await assertCanAccessSessionChat({ userId, role, sessionId });
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  const limit = Math.min(parseInt(queryParams.limit, 10) || 50, 200);
  const before = queryParams.before ? new Date(queryParams.before) : new Date();

  const messages = await LiveChatMessage.find({
    sessionId: safeSessionId,
    createdAt: { $lt: before },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return { success: true, data: { messages: messages.reverse() } };
}

module.exports = { sendChatMessage, getChatMessages, assertCanAccessSessionChat };
