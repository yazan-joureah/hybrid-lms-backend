const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/chat';
const REQUEST_TIMEOUT_MS = 220000;

async function generateCompletion({ systemPrompt, userMessage }) {
  const env = require('../../../config/env');
  const model = env.ai.tinyllama?.model || 'tinyllama';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: {
          temperature: 0.4,
          num_predict: 512, // TinyLlama is smaller, keep context reasonable[cite: 6]
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`TinyLlama request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    if (err.code === 'ECONNREFUSED') {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw new Error(`TinyLlama request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `TinyLlama API error (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const data = await response.json();
  const text = data?.message?.content;

  if (!text) {
    throw new Error('TinyLlama returned an empty completion.');
  }

  return { text: text.trim(), provider: 'tinyllama' };
}

module.exports = { generateCompletion };
