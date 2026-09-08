// src/services/ai/providers/tinyllama.provider.js
//
// DEVIATION (Live Demo Setup):
// For the graduation defense live demo, this provider is connected to a local
// Ollama instance via a temporary ngrok tunnel.
//
// Steps to run for demo:
// 1. Local: `ollama serve`
// 2. Local: `ngrok http 11434`
// 3. Render: Set OLLAMA_API_URL = https://<your-ngrok-url>/api/chat
// 4. Render: Set AI_PROVIDER = tinyllama
//
// NOTE: The ngrok tunnel must be closed immediately after the presentation.

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/chat'; //[cite: 6]
const REQUEST_TIMEOUT_MS = 30000; //[cite: 6]

async function generateCompletion({ systemPrompt, userMessage }) {
  //[cite: 6]
  const env = require('../../../config/env'); //[cite: 6]
  const model = env.ai.tinyllama?.model || 'tinyllama'; //[cite: 6]

  const controller = new AbortController(); //[cite: 6]
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); //[cite: 6]

  let response; //[cite: 6]
  try {
    response = await fetch(OLLAMA_API_URL, {
      //[cite: 6]
      method: 'POST', //[cite: 6]
      headers: { 'Content-Type': 'application/json' }, //[cite: 6]
      body: JSON.stringify({
        //[cite: 6]
        model, //[cite: 6]
        messages: [
          //[cite: 6]
          { role: 'system', content: systemPrompt }, //[cite: 6]
          { role: 'user', content: userMessage }, //[cite: 6]
        ],
        stream: false, //[cite: 6]
        options: {
          //[cite: 6]
          temperature: 0.4, //[cite: 6]
          num_predict: 512, // TinyLlama is smaller, keep context reasonable[cite: 6]
        },
      }),
      signal: controller.signal, //[cite: 6]
    });
  } catch (err) {
    //[cite: 6]
    if (err.name === 'AbortError') {
      //[cite: 6]
      throw new Error(`TinyLlama request timed out after ${REQUEST_TIMEOUT_MS}ms`); //[cite: 6]
    }
    if (err.code === 'ECONNREFUSED') {
      //[cite: 6]
      throw new Error('Ollama is not running. Start it with: ollama serve'); //[cite: 6]
    }
    throw new Error(`TinyLlama request failed: ${err.message}`); //[cite: 6]
  } finally {
    //[cite: 6]
    clearTimeout(timeout); //[cite: 6]
  }

  if (!response.ok) {
    //[cite: 6]
    const errorBody = await response.text().catch(() => ''); //[cite: 6]
    throw new Error(
      //[cite: 6]
      `TinyLlama API error (${response.status}): ${errorBody || response.statusText}` //[cite: 6]
    );
  }

  const data = await response.json(); //[cite: 6]
  const text = data?.message?.content; //[cite: 6]

  if (!text) {
    //[cite: 6]
    throw new Error('TinyLlama returned an empty completion.'); //[cite: 6]
  }

  return { text: text.trim(), provider: 'tinyllama' }; //[cite: 6]
}

module.exports = { generateCompletion }; //[cite: 6]
