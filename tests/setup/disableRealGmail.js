/**
 * Test-environment isolation guard.
 *
 * WHY EMPTY STRING, NOT delete: dotenv's default behavior is to NEVER
 * overwrite a key that already exists in process.env (override: false by
 * default). If we `delete` these keys instead, dotenv.config() — which
 * runs later when src/config/env.js is first required by the app — would
 * see them as "unset" and load the REAL secrets from .env, defeating this
 * guard entirely. Setting them to '' keeps the key present (so dotenv
 * leaves it alone) while remaining falsy for isGmailConfigured()'s check.
 *
 * This guarantees the emailService.js dev-mode fallback (console log,
 * documented at the top of that file) is ALWAYS used during automated
 * tests — Gmail's real API is architecturally unreachable from this test
 * suite, by construction, not by convention.
 */
process.env.GMAIL_CLIENT_ID = '';
process.env.GMAIL_CLIENT_SECRET = '';
process.env.GMAIL_REFRESH_TOKEN = '';
process.env.GMAIL_SENDER_EMAIL = '';
