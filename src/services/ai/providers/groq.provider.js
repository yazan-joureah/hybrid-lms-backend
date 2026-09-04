// src/services/ai/providers/groq.provider.js
//
// مزوّد Groq — مجاني بالكامل، بلا بطاقة ائتمان، بلا حد زمني معلن لانتهاء
// الصلاحية (بعكس DeepSeek). واجهة OpenAI-compatible قياسية.
// التسجيل: https://console.groq.com/keys

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const REQUEST_TIMEOUT_MS = 30000;

async function generateCompletion({ systemPrompt, userMessage }) {
  const env = require('../../../config/env');
  const apiKey = env.ai.groq.apiKey;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not set — required when AI_PROVIDER=groq. Check your .env file.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Groq request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`Groq request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Groq API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('Groq returned an empty completion — check API response shape.');
  }

  return { text: text.trim(), provider: 'groq' };
}

module.exports = { generateCompletion };
