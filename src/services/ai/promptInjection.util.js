// src/services/ai/promptInjection.util.js
//
// OWASP LLM01 — Prompt Injection defenses for SF-AI-01 / SF-AI-02.
// Pattern-level detection is inherently incomplete (no static regex list
// catches every jailbreak phrasing) — this is a first line of defense
// meant to be layered with the fixed, server-locked system prompt itself
// (which never leaves the server and is never built from client input),
// NOT a claim of perfect detection. Every match is logged to AuditLog by
// the calling service so false negatives remain reviewable later.

const INJECTION_PATTERNS = [
  // English — classic "override the instructions" phrasing
  /ignore\s+(all|the|any|previous|above)\s+(previous\s+)?instructions?/i,
  /disregard\s+(all|the|any|previous|above)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(if\s+you\s+(are|were)|a|an)\s+/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /what\s+(is|are)\s+your\s+(system\s+)?instructions?/i,
  /repeat\s+(the\s+text\s+)?above/i,
  /\bDAN\b|do\s+anything\s+now/i,
  /jailbreak/i,
  /developer\s+mode/i,

  // Arabic — نفس النية بصياغات شائعة
  /تجاهل\s+(كل\s+)?(التعليمات|الأوامر)/,
  /تجاهل\s+تعليماتك/,
  /انسَ\s+كل\s+ما\s+سبق/,
  /من\s+الآن\s+(فصاعداً\s+)?أنت/,
  /تصرف\s+وكأنك/,
  /اكشف\s+(عن\s+)?(تعليماتك|التعليمات|النظام)/,
  /ما\s+هي\s+تعليماتك/,
  /أظهر\s+(لي\s+)?(الـ)?prompt/i,
];

// محاولة إفلات عبر بنية رسائل مزيَّفة (تقليد فواصل الأدوار التي يفهمها
// الـ LLM كحدود بين System/Assistant/User) — نُحيِّدها عوضاً عن رفض
// الرسالة بالكامل، لأنها قد تظهر بالصدفة في نص بريء.
const ROLE_MARKER_PATTERN = /\b(system|assistant|user)\s*:/gi;

function detectPromptInjection(text) {
  if (!text) return { flagged: false, reason: null };
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: 'PROMPT_INJECTION_PATTERN_MATCHED' };
    }
  }
  return { flagged: false, reason: null };
}

// UC-AI-02 امتداد [b2] — طلب إجابة امتحان مباشرة (طالب فقط)
const EXAM_ANSWER_PATTERNS = [
  /answer\s+(to|for)\s+(question|exam|quiz)/i,
  /correct\s+answer\s+(is|for)/i,
  /solve\s+(this\s+)?(exam|quiz|test)\s+for\s+me/i,
  /الإجابة\s+(الصحيحة|الصح)\s+(لـ|ل|على)?\s*(السؤال|الامتحان|الاختبار)/,
  /إجابة\s+(الامتحان|الاختبار|السؤال\s+رقم)/,
  /حل\s+(لي\s+)?(الامتحان|الاختبار)/,
];

function detectExamAnswerRequest(text) {
  if (!text) return { flagged: false, reason: null };
  for (const pattern of EXAM_ANSWER_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: 'DIRECT_EXAM_ANSWER_REQUEST' };
    }
  }
  return { flagged: false, reason: null };
}

/**
 * تعقيم النص قبل تمريره لأي مزوّد LLM: إزالة محارف التحكم غير المرئية
 * (التي قد تُستخدَم لإخفاء تعليمات)، وتحييد فواصل الأدوار المزيَّفة، مع
 * قصّ الطول كطبقة دفاع إضافية بصرف النظر عن حد Zod الأعلى في الـ Route.
 */
function sanitizeForLLM(rawText, { maxLength = 4000 } = {}) {
  if (typeof rawText !== 'string') return '';
  // يزيل محارف التحكم غير المرئية التي قد تُخفي تعليمات مُحقَنة عن مراجِع
  // بشري بينما تبقى مقروءة لنموذج لغوي — مقصودة، وليست خطأ اعتراضياً.
  const stripped = rawText
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(ROLE_MARKER_PATTERN, '[$1]') // "system:" → "[system]" (يُبطل تقليد الأدوار)
    .trim();
  return stripped.slice(0, maxLength);
}

/**
 * UC-AI-06 امتداد [a4] — يفحص مخرجات المساعد بحثاً عن أي اسم من طلاب
 * الكورس المسجَّلين قبل عرضها للمحاضر (بيانات مُجمَّعة فقط، بلا هوية
 * فردية). مطابقة حرفية بسيطة — وليست NLP كاملة — وهي متعمَّدة: نفضِّل
 * حجب مخرَج بالخطأ (False Positive) على تسريب اسم طالب فعلي.
 */
function containsAnyStudentName(text, studentFullNames = []) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return studentFullNames.some((name) => {
    const trimmed = (name || '').trim();
    return trimmed.length >= 3 && lowerText.includes(trimmed.toLowerCase());
  });
}

module.exports = {
  detectPromptInjection,
  detectExamAnswerRequest,
  sanitizeForLLM,
  containsAnyStudentName,
};
