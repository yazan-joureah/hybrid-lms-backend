// src/services/ai/llmProvider.service.js

const env = require('../../config/env');
const AI_PROVIDER = env.ai.provider;

async function generateCompletion({ systemPrompt, userMessage, context = {} }) {
  switch (AI_PROVIDER) {
    case 'stub':
      return stubGenerateCompletion({ systemPrompt, userMessage, context });

    case 'ollama':
      return require('./providers/ollama.provider').generateCompletion({
        systemPrompt,
        userMessage,
        context,
      });

    case 'tinyllama':
      return require('./providers/tinyllama.provider').generateCompletion({
        systemPrompt,
        userMessage,
        context,
      });

    default:
      throw new Error(`Unknown AI_PROVIDER "${AI_PROVIDER}" — check .env`);
  }
}

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

  const text = Object.prototype.hasOwnProperty.call(templates, mode)
    ? templates[mode]
    : templates.general;
  return { text, provider: 'stub' };
}

function truncate(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

module.exports = { generateCompletion, AI_PROVIDER };
