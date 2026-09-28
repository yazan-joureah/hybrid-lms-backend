// src/services/ai/history.service.js
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
      text: crypto.decryptForUser(toRealBuffer(m.ciphertext), safeStudentId).toString('utf8'),
      flagged: m.flagged,
      createdAt: m.createdAt,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  return { success: true, data: { messages } };
}

function toRealBuffer(value) {
  if (Buffer.isBuffer(value)) return value;

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  if (value && value._bsontype === 'Binary' && value.buffer) {
    return Buffer.from(value.buffer);
  }

  throw new TypeError(
    `toRealBuffer: unrecognized encrypted value shape (constructor: ${value?.constructor?.name || typeof value})`
  );
}

module.exports = { listConversationHistory, toRealBuffer };
