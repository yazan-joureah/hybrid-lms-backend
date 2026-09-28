const env = require('../../../config/env');
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = env.ai.deepseek.model;
const REQUEST_TIMEOUT_MS = 30000;

async function generateCompletion({ systemPrompt, userMessage }) {
  const apiKey = env.ai.deepseek.apiKey;
  if (!apiKey) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set — required when AI_PROVIDER=deepseek. Check your .env file.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
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
      throw new Error(`DeepSeek request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`DeepSeek request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('DeepSeek returned an empty completion — check API response shape.');
  }

  return { text: text.trim(), provider: 'deepseek' };
}

module.exports = { generateCompletion };
