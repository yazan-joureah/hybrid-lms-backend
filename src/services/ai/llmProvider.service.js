// src/services/ai/llmProvider.service.js
//
// DEVIATION: no live LLM provider is configured — see memory decision
// (AI Assistant module: Stub بلا مزوّد LLM حقيقي، بنية أمنية كاملة قابلة
// للتبديل لاحقاً). السبب: كل مزوّدي الـ LLM السحابيين الفعليين إما يطلبون
// بطاقة ائتمان عند التفعيل (Google Gemini / OpenAI) حتى ضمن "المستوى
// المجاني"، أو يقدِّمون منحة تنتهي صلاحيتها خلال مدة قصيرة (DeepSeek —
// 30 يوماً فقط)، ما لا يناسب مشروع تخرج يمتد لفصل دراسي كامل أو أكثر
// (principle #7/#8: تجنّب أي خدمة تتطلب دفعاً أو بطاقة قدر الإمكان).
//
// القرار الهندسي: فصل منطق الأمان (SF-AI-01/02، Sanitization، منع
// Prompt Injection، عزل بيانات الطلاب — الثابت والحرج والقابل للتقييم من
// لجنة المناقشة) عن مزوّد النموذج الفعلي (المتغيّر، الخارجي) خلف واجهة
// موحَّدة واحدة. التبديل لمزوّد حقيقي لاحقاً (مثال: Ollama محلي مع
// Llama/Mistral — مجاني بالكامل ودائم، بلا أي بطاقة) يتم بتعديل هذا
// الملف فقط، دون أي إعادة هيكلة لبقية الوحدة.

const AI_PROVIDER = process.env.AI_PROVIDER || 'stub';

/**
 * الواجهة الموحَّدة التي يعتمد عليها بقية كود الوحدة (session/query
 * services) — ثابتة بصرف النظر عن المزوّد الفعلي خلفها.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - الناتج المُقفَل من SF-AI-01/SF-AI-02
 * @param {string} params.userMessage - رسالة المستخدم بعد التعقيم
 * @param {object} [params.context] - بيانات إضافية اختيارية (mode، إلخ)
 * @returns {Promise<{ text: string, provider: string }>}
 */
async function generateCompletion({ systemPrompt, userMessage, context = {} }) {
  switch (AI_PROVIDER) {
    case 'stub':
      return stubGenerateCompletion({ systemPrompt, userMessage, context });

    // مكان التوسّع المستقبلي — مثال (غير مُفعَّل الآن):
    // case 'ollama':
    //   return require('./providers/ollama.provider').generateCompletion({ systemPrompt, userMessage, context });

    default:
      throw new Error(`Unknown AI_PROVIDER "${AI_PROVIDER}" — check .env`);
  }
}

/**
 * مزوّد وهمي (Stub) — لا يستدعي أي API خارجي إطلاقاً. يُعيد رداً ثابتاً
 * سياقياً معقولاً بما يكفي لاختبار وعرض تدفّق الوحدة بالكامل (الجلسة،
 * التعقيم، التخزين المُشفَّر، السجل) دون أي استدعاء شبكي أو تكلفة.
 */
async function stubGenerateCompletion({ systemPrompt: _systemPrompt, userMessage, context = {} }) {
  const mode = context.mode || 'general';

  const templates = {
    student_query:
      `[استجابة تجريبية — لا يوجد مزوّد LLM حقيقي مُفعَّل حالياً]\n` +
      `بخصوص سؤالك: "${truncate(userMessage, 200)}"\n` +
      `هذا رد وهمي (Stub) موثَّق ضمن بنية الوحدة الأمنية الكاملة — راجع llmProvider.service.js. ` +
      `عند تفعيل مزوّد حقيقي لاحقاً، سيُستبدَل هذا النص برد فعلي مبني على سياق الكورس المُحقَن في System Prompt.`,
    instructor_suggestions:
      `[استجابة تجريبية — لا يوجد مزوّد LLM حقيقي مُفعَّل حالياً]\n` +
      `بخصوص طلبك: "${truncate(userMessage, 200)}"\n` +
      `مقترح عام (Stub): راجع تسلسل الوحدات وتأكد من وجود أمثلة تطبيقية بعد كل مفهوم نظري، ` +
      `وأضف سؤال مراجعة قصيراً في نهاية كل وحدة لتثبيت الفهم.`,
    instructor_performance_summary:
      `[استجابة تجريبية — لا يوجد مزوّد LLM حقيقي مُفعَّل حالياً]\n` +
      `ملخص عام (Stub) بناءً على البيانات المُجمَّعة المُرسَلة في System Prompt: ` +
      `الأداء ضمن النطاق المتوقَّع بلا مؤشرات حرجة ظاهرة. عند تفعيل مزوّد حقيقي، ` +
      `سيُبنى الملخص فعلياً من هذه الإحصاءات دون أي هوية فردية.`,
    general:
      `[استجابة تجريبية — لا يوجد مزوّد LLM حقيقي مُفعَّل حالياً]\n` +
      `تم استلام رسالتك ومعالجتها عبر طبقة الأمان الكاملة للوحدة (SF-AI-01/02، ` +
      `Sanitization، فحص Prompt Injection). هذا رد Stub ثابت فقط.`,
  };

  const text = Object.prototype.hasOwnProperty.call(templates, mode) ? templates[mode] : templates.general;
  return { text, provider: 'stub' };
}

function truncate(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

module.exports = { generateCompletion, AI_PROVIDER };
