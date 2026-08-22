// src/services/ai/history.service.js
// UC-AI-03 — View AI Conversation History (Student)
//
// أمنياً (منع MUC-AI-07 / IDOR): studentId يأتي حصراً من req.user.id
// (JWT) في الـ controller — هذه الدالة لا تقبل أي معرِّف آخر، ولا يوجد
// أي مسار في aiRoutes.js يمرِّر studentId كـ param أو body.

const AIConversation = require('../../models/AIConversation');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const crypto = require('../../utils/crypto');

async function listConversationHistory({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const conversation = await AIConversation.findOne({
    userId: safeStudentId,
    courseId: safeCourseId,
    role: 'Student',
  }).lean();

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'AI_CONVERSATION_HISTORY_VIEWED',
    resourceType: 'AIConversation',
    resourceId: conversation?._id?.toString() || safeCourseId.toString(),
    req,
  });

  if (!conversation) {
    return { success: true, data: { messages: [] } };
  }

  const messages = conversation.messages
    .map((m) => ({
      sender: m.sender,
      text: crypto.decryptForUser(m.ciphertext, safeStudentId).toString('utf8'),
      flagged: m.flagged,
      createdAt: m.createdAt,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  return { success: true, data: { messages } };
}

module.exports = { listConversationHistory };
