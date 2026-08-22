// src/services/ai/instructorQuery.service.js
// UC-AI-05 — Generate Content Improvement Suggestions
// UC-AI-06 — View AI Performance Summary

const AIConversation = require('../../models/AIConversation');
const User = require('../../models/User');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const llmProvider = require('./llmProvider.service');
const { persistExchange } = require('./studentQuery.service');
const { sanitizeForLLM, detectPromptInjection, containsAnyStudentName } = require('./promptInjection.util');

const INJECTION_REFUSAL =
  'لم أتمكن من معالجة هذه الرسالة. برجاء إعادة صياغة طلبك ضمن نطاق محتوى الكورس.';

// UC-AI-06 امتداد [a4] — رد بديل ثابت عندما يُحجَب مخرَج المساعد بسبب
// احتوائه اسم طالب فعلي (انتهاك خصوصية) — لا يُعرَض النص الأصلي إطلاقاً.
const PRIVACY_VIOLATION_FALLBACK =
  'تعذَّر عرض الملخص لأن المخرَج تضمَّن إشارة إلى هوية فردية. برجاء إعادة المحاولة — سيتم تسجيل هذا الحدث.';

async function loadActiveInstructorConversation({ instructorId, courseId }) {
  const conversation = await AIConversation.findOne({
    userId: instructorId,
    courseId,
    role: 'Instructor',
    status: 'active',
  });
  if (!conversation) {
    throw new AppError(
      400,
      'SESSION_NOT_STARTED',
      'يجب بدء جلسة المساعد أولاً لهذا الكورس قبل إرسال أي طلب.'
    );
  }
  return conversation;
}

/** UC-AI-05 — اقتراح تحسينات محتوى. */
async function generateContentSuggestions({ instructorId, courseId, message, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const conversation = await loadActiveInstructorConversation({
    instructorId: safeInstructorId,
    courseId: safeCourseId,
  });

  const sanitized = sanitizeForLLM(message);

  const injectionCheck = detectPromptInjection(sanitized);
  if (injectionCheck.flagged) {
    await persistExchange({ conversation, userText: sanitized, assistantText: INJECTION_REFUSAL, flagged: true });
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'AI_PROMPT_INJECTION_DETECTED',
      resourceType: 'AIConversation',
      resourceId: conversation._id.toString(),
      metadata: { reason: injectionCheck.reason },
      req,
    });
    return { success: true, data: { reply: INJECTION_REFUSAL, flagged: true } };
  }

  const completion = await llmProvider.generateCompletion({
    systemPrompt: conversation.systemPromptSnapshot,
    userMessage: sanitized,
    context: { mode: 'instructor_suggestions' },
  });

  await persistExchange({ conversation, userText: sanitized, assistantText: completion.text, flagged: false });

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'AI_INSTRUCTOR_CONTENT_SUGGESTION',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { provider: completion.provider },
    req,
  });

  return { success: true, data: { reply: completion.text, flagged: false } };
}

/** UC-AI-06 — ملخص أداء الطلاب (مُجمَّع، بلا هوية فردية). */
async function performanceSummary({ instructorId, courseId, focus, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const conversation = await loadActiveInstructorConversation({
    instructorId: safeInstructorId,
    courseId: safeCourseId,
  });

  const requestText = sanitizeForLLM(focus || 'قدِّم ملخصاً عاماً لأداء الطلاب في هذا الكورس.');

  const activeEnrollments = await Enrollment.find({ course_id: safeCourseId, status: 'active' }).lean();
  if (activeEnrollments.length === 0) {
    const noDataMsg = 'لا توجد بيانات كافية حتى الآن لهذا الكورس.';
    return { success: true, data: { reply: noDataMsg, flagged: false } };
  }

  const completion = await llmProvider.generateCompletion({
    systemPrompt: conversation.systemPromptSnapshot,
    userMessage: requestText,
    context: { mode: 'instructor_performance_summary' },
  });

  // [a4] فحص خصوصية إلزامي قبل أي عرض: هل يحتوي المخرَج اسم طالب فعلي؟
  const studentIds = activeEnrollments.map((e) => e.student_id);
  const students = await User.find({ _id: { $in: studentIds } }).select('full_name').lean();
  const studentNames = students.map((s) => s.full_name).filter(Boolean);

  if (containsAnyStudentName(completion.text, studentNames)) {
    await persistExchange({
      conversation,
      userText: requestText,
      assistantText: PRIVACY_VIOLATION_FALLBACK,
      flagged: true,
    });
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'AI_PRIVACY_VIOLATION_BLOCKED',
      resourceType: 'AIConversation',
      resourceId: conversation._id.toString(),
      metadata: { reason: 'OUTPUT_CONTAINED_STUDENT_NAME' },
      req,
    });
    return { success: true, data: { reply: PRIVACY_VIOLATION_FALLBACK, flagged: true } };
  }

  await persistExchange({ conversation, userText: requestText, assistantText: completion.text, flagged: false });

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'AI_INSTRUCTOR_PERFORMANCE_SUMMARY',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { provider: completion.provider, activeEnrollmentCount: activeEnrollments.length },
    req,
  });

  return { success: true, data: { reply: completion.text, flagged: false } };
}

module.exports = { generateContentSuggestions, performanceSummary };
