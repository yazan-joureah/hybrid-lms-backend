// src/services/ai/studentQuery.service.js
// UC-AI-02 — Query AI Assistant (Student)

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

// UC-AI-02 امتداد [b2] — رد ثابت لا يستدعي أي مزوّد LLM إطلاقاً عند رصد
// طلب إجابة امتحان مباشرة، بنفس النص الحرفي الوارد في الوثيقة الأصلية.
const EXAM_ANSWER_REFUSAL =
  'لا أستطيع تزويدك بإجابات الامتحانات مباشرةً، لكن يمكنني مساعدتك في فهم المفهوم.';

// UC-AI-02 امتداد [a2] — رد ثابت عند رصد محاولة Prompt Injection، أيضاً
// بلا أي استدعاء لمزوّد LLM (لا داعي لإنفاق أي استدعاء على رسالة مرفوضة أصلاً).
const INJECTION_REFUSAL =
  'لم أتمكن من معالجة هذه الرسالة. برجاء إعادة صياغة سؤالك ضمن نطاق محتوى الكورس.';

/**
 * UC-AI-02 — يكتب الطالب سؤاله ضمن جلسة مفتوحة مسبقاً (UC-AI-01 + SF-AI-02).
 */
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

  // [2a] رصد محاولة Prompt Injection — حجب الطلب قبل الوصول لأي مزوّد LLM
  const injectionCheck = detectPromptInjection(sanitized);
  if (injectionCheck.flagged) {
    await persistExchange({ conversation, userText: sanitized, assistantText: INJECTION_REFUSAL, flagged: true });
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

  // [b2] رصد طلب إجابة امتحان مباشرة — رد ثابت بلا استدعاء LLM
  const examCheck = detectExamAnswerRequest(sanitized);
  if (examCheck.flagged) {
    await persistExchange({ conversation, userText: sanitized, assistantText: EXAM_ANSWER_REFUSAL, flagged: true });
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

  await persistExchange({ conversation, userText: sanitized, assistantText: completion.text, flagged: false });

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'AI_STUDENT_QUERY',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { provider: completion.provider }, // لا يُسجَّل نص السؤال/الجواب في AuditLog أبداً
    req,
  });

  return { success: true, data: { reply: completion.text, flagged: false } };
}

/**
 * يُخزِّن رسالتَي التبادل (مستخدم + مساعد) مُشفَّرتين AES-256-GCM كلٌّ على
 * حدة، بمفتاح مشتَق من userId (نفس آلية KYC — crypto.encryptForUser).
 */
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
