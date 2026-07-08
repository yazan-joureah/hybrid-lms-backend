/**
 * Cloudflare Turnstile verification Invoked only on
 * the retry path after a 429 rate-limit response (MUC-AUTH-04).
 *
 * Verify endpoint confirmed against official Cloudflare docs
 * (developers.cloudflare.com/turnstile) — JSON body is supported.
 */

const env = require('../config/env');
const logger = require('../utils/logger');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstileToken(token, remoteIp) {
  if (!env.turnstileSecretKey) {
    // Not configured (e.g. local dev without Cloudflare setup) — fail closed
    // in production, but allow through in development for local testing.
    if (env.nodeEnv === 'production') return false;
    logger.debug('Turnstile secret not configured — skipping verification (dev only)');
    return true;
  }

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.turnstileSecretKey, response: token, remoteip: remoteIp }),
    });
    const result = await response.json();
    return result.success === true;
  } catch (err) {
    logger.error('Turnstile verification request failed', { error: err.message });
    return false;
  }
}

module.exports = { verifyTurnstileToken };
