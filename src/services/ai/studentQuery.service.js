// src/services/ai/studentQuery.service.js

const AIConversation = require('../../models/AIConversation');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const crypto = require('../../utils/crypto');
const llmProvider = require('./llmProvider.service');
const {
  sanitizeForLLM,
  detectPromptInjection,
  detectExamAnswerRequest,
} = require('./promptInjection.util');

const EXAM_ANSWER_REFUSAL =
  'لا أستطيع تزويدك بإجابات الامتحانات مباشرةً، لكن يمكنني مساعدتك في فهم المفهوم.';

const INJECTION_REFUSAL =
  'لم أتمكن من معالجة هذه الرسالة. برجاء إعادة صياغة سؤالك ضمن نطاق محتوى الكورس.';

async function queryAssistant({ studentId, courseId, message, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const conversation = await AIConversation.findOne({
    userId: safeStudentId,
    courseId: safeCourseId,
    role: 'Student',
    status: 'active',
  });

  if (!conversation) {
    throw new AppError(
      400,
      'SESSION_NOT_STARTED',
      'يجب بدء جلسة المساعد أولاً لهذا الكورس قبل إرسال أي سؤال.'
    );
  }

  const sanitized = sanitizeForLLM(message);

  const injectionCheck = detectPromptInjection(sanitized);
  if (injectionCheck.flagged) {
    await persistExchange({
      conversation,
      userText: sanitized,
      assistantText: INJECTION_REFUSAL,
      flagged: true,
    });
    await auditService.record({
      actorId: safeStudentId,
      actorRole: 'Student',
      action: 'AI_PROMPT_INJECTION_DETECTED',
      resourceType: 'AIConversation',
      resourceId: conversation._id.toString(),
      metadata: { reason: injectionCheck.reason },
      req,
    });
    return { success: true, data: { reply: INJECTION_REFUSAL, flagged: true } };
  }

  const examCheck = detectExamAnswerRequest(sanitized);
  if (examCheck.flagged) {
    await persistExchange({
      conversation,
      userText: sanitized,
      assistantText: EXAM_ANSWER_REFUSAL,
      flagged: true,
    });
    await auditService.record({
      actorId: safeStudentId,
      actorRole: 'Student',
      action: 'AI_EXAM_ANSWER_REQUEST_BLOCKED',
      resourceType: 'AIConversation',
      resourceId: conversation._id.toString(),
      metadata: { reason: examCheck.reason },
      req,
    });
    return { success: true, data: { reply: EXAM_ANSWER_REFUSAL, flagged: true } };
  }

  const completion = await llmProvider.generateCompletion({
    systemPrompt: conversation.systemPromptSnapshot,
    userMessage: sanitized,
    context: { mode: 'student_query' },
  });

  await persistExchange({
    conversation,
    userText: sanitized,
    assistantText: completion.text,
    flagged: false,
  });

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'AI_STUDENT_QUERY',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { provider: completion.provider },
    req,
  });

  return { success: true, data: { reply: completion.text, flagged: false } };
}

async function persistExchange({ conversation, userText, assistantText, flagged }) {
  const userId = conversation.userId;
  conversation.messages.push({
    sender: 'user',
    ciphertext: crypto.encryptForUser(Buffer.from(userText, 'utf8'), userId),
    flagged,
  });
  conversation.messages.push({
    sender: 'assistant',
    ciphertext: crypto.encryptForUser(Buffer.from(assistantText, 'utf8'), userId),
    flagged: false,
  });
  conversation.lastMessageAt = new Date();
  await conversation.save();
}

module.exports = { queryAssistant, persistExchange };
