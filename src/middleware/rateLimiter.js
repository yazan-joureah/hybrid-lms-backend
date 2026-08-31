/**
 * Dual-axis rate limiting (per IP + per identifier) with Android-style
 * exponential backoff lockout. Source: NFR-03.
 *
 * ── DEVIATION (fixed here) ──────────────────────────────────────────────
 * The original single-function design incremented the hit counter on
 * EVERY request reaching the middleware — success or failure alike. That
 * silently violates the very standard this design cites: NIST SP 800-63B
 * §3.2.2 requires throttling "the number of FAILED authentication
 * attempts", not total attempts. A legitimate user logging in 5 times
 * successfully within 10 minutes (entirely normal — e.g. switching roles
 * during a live demo) was consuming the exact same budget meant to stop
 * credential-stuffing.
 *
 * This file now exposes TWO distinct patterns:
 *
 *  1. `rateLimit(actionKey, identifierExtractor)` — the ORIGINAL
 *     count-everything middleware. Kept unchanged and still correct for
 *     endpoints where the *request itself* is the resource being
 *     protected regardless of outcome (sending an email, creating a
 *     course/quiz/session, submitting a peer assignment) — per the
 *     project's own Rate Limiting rule (creates a record / consumes a
 *     resource / notifies a third party / feeds security-sensitive
 *     logic — Abstraction.md).
 *
 *  2. `checkLock(actionKey, identifierExtractor)` + `recordFailure(...)`
 *     — a NEW pair for genuine credential-guessing endpoints (login, MFA
 *     verification). `checkLock` is a read-only middleware that ONLY
 *     rejects if an axis is already locked from a PRIOR escalation — it
 *     never increments anything. The Controller then calls
 *     `recordFailure()` explicitly, and ONLY when the attempt genuinely
 *     failed (wrong password / wrong OTP-TOTP code). Success is never
 *     charged against the budget.
 *
 *     `recordSuccess()` is an optional companion that clears the hit
 *     counters immediately on a genuine success, so a user who mistyped
 *     their password twice then got it right on the third try doesn't
 *     carry residual "near-miss" hits into their next window.
 *
 * Security note (unchanged from original design): the lockout is
 * time-bound and never permanent, and keys off BOTH IP and identifier —
 * this avoids the "weaponized lockout" DoS vector (an attacker
 * deliberately failing a victim's identifier to lock them out
 * indefinitely), since IP-side throttling also applies and every lock
 * self-expires regardless of further requests.
 */
const redisClient = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Checks whether a given lock key is currently active, and if so, how many
 * seconds remain. Uses Redis TTL as the single source of truth — no need
 * to store or parse a timestamp value ourselves.
 */
async function secondsRemainingIfLocked(lockKey) {
  const ttl = await redisClient.ttl(lockKey);
  return ttl > 0 ? ttl : null;
}

/**
 * Increments a counter and, only on its FIRST increment, attaches an
 * expiry. This is the standard "fixed window counter" pattern — cheaper
 * than a sliding window and precise enough for this use case.
 */
async function incrementWithExpiry(key, ttlSeconds) {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, ttlSeconds);
  }
  return count;
}

/**
 * Android-style escalation: each time this specific key breaches the
 * threshold, its "violation count" persists (24h by default) and the next
 * lockout duration is 2x the previous one, up to a hard cap.
 *
 * violationCount=1 → 30s
 * violationCount=2 → 60s
 * violationCount=3 → 120s
 * ... capped at maxLockoutSeconds (default 30 min)
 */
function computeLockoutSeconds(violationCount) {
  const raw = env.rateLimit.baseLockoutSeconds * Math.pow(2, violationCount - 1);
  return Math.min(raw, env.rateLimit.maxLockoutSeconds);
}

/**
 * Evaluates ONE axis (either the IP or the identifier). If the hit count
 * within the window exceeds the allowed threshold, it escalates the
 * violation counter and activates a lock for the computed duration.
 * Returns null if not breached, or the lockout duration (seconds) if it
 * just triggered a new lock.
 */
async function evaluateAxis(hitsKey, lockKey, violationsKey, windowSeconds) {
  const hits = await incrementWithExpiry(hitsKey, windowSeconds);
  if (hits <= env.rateLimit.maxAttempts) {
    return null;
  }

  const violations = await incrementWithExpiry(violationsKey, env.rateLimit.violationsTtlSeconds);
  const lockoutSeconds = computeLockoutSeconds(violations);

  await redisClient.set(lockKey, '1', 'EX', lockoutSeconds);
  await redisClient.del(hitsKey); // clean slate for the next window once the lock expires

  return lockoutSeconds;
}

function rejectLocked(res, seconds) {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  });
}

/**
 * PATTERN 1 — count everything (original behavior, unchanged).
 * Use for resource-creation / notification-sending endpoints where the
 * request itself is what's being throttled, regardless of outcome.
 *
 * @param {string} actionKey - short identifier for the protected action, e.g. "register"
 * @param {(req) => string} identifierExtractor - derives the secondary axis (e.g. email from body)
 */
function rateLimit(actionKey, identifierExtractor) {
  return async (req, res, next) => {
    try {
      const ip = req.ip;
      const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';
      const windowSeconds = Math.floor(env.rateLimit.windowMs / 1000);

      const ipLockKey = `rl:lock:${actionKey}:ip:${ip}`;
      const idLockKey = `rl:lock:${actionKey}:id:${identifier}`;

      const [ipLockedFor, idLockedFor] = await Promise.all([
        secondsRemainingIfLocked(ipLockKey),
        secondsRemainingIfLocked(idLockKey),
      ]);
      const alreadyLockedFor = Math.max(ipLockedFor || 0, idLockedFor || 0);
      if (alreadyLockedFor > 0) {
        return rejectLocked(res, alreadyLockedFor);
      }

      const [ipLock, idLock] = await Promise.all([
        evaluateAxis(
          `rl:hits:${actionKey}:ip:${ip}`,
          ipLockKey,
          `rl:violations:${actionKey}:ip:${ip}`,
          windowSeconds
        ),
        evaluateAxis(
          `rl:hits:${actionKey}:id:${identifier}`,
          idLockKey,
          `rl:violations:${actionKey}:id:${identifier}`,
          windowSeconds
        ),
      ]);

      const newlyLockedFor = Math.max(ipLock || 0, idLock || 0);
      if (newlyLockedFor > 0) {
        return rejectLocked(res, newlyLockedFor);
      }

      next();
    } catch (err) {
      // Fail-open on Redis outage — a single infra failure must not take
      // down registration entirely. Logged for visibility, never silent.
      logger.error('Rate limiter error — failing open', { error: err.message, actionKey });
      next();
    }
  };
}

/**
 * PATTERN 2a — read-only lock check (middleware). Rejects ONLY if an axis
 * is already locked from a PRIOR escalation triggered by recordFailure().
 * Never increments any counter by itself — mount this in front of any
 * route whose Controller will call recordFailure()/recordSuccess()
 * explicitly once the outcome is known.
 */
function checkLock(actionKey, identifierExtractor) {
  return async (req, res, next) => {
    try {
      const ip = req.ip;
      const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';

      const [ipLockedFor, idLockedFor] = await Promise.all([
        secondsRemainingIfLocked(`rl:lock:${actionKey}:ip:${ip}`),
        secondsRemainingIfLocked(`rl:lock:${actionKey}:id:${identifier}`),
      ]);
      const lockedFor = Math.max(ipLockedFor || 0, idLockedFor || 0);
      if (lockedFor > 0) {
        return rejectLocked(res, lockedFor);
      }
      next();
    } catch (err) {
      logger.error('Rate limiter (checkLock) error — failing open', {
        error: err.message,
        actionKey,
      });
      next();
    }
  };
}

/**
 * PATTERN 2b — explicit failure recorder. Call ONLY when an attempt
 * genuinely failed (wrong password, wrong OTP/TOTP code) — never on
 * success. This is what makes the budget "N *failed* attempts" per NIST
 * SP 800-63B §3.2.2, instead of "N attempts total".
 *
 * Deliberately does NOT shape the HTTP response itself — it only decides
 * whether/how long to throttle. The Controller stays in charge of the
 * actual response body (still a generic "invalid credentials" message
 * either way — this function must never leak *why* a request failed).
 *
 * @returns {Promise<{locked: boolean, lockoutSeconds: number|null}>}
 */
async function recordFailure(req, actionKey, identifierExtractor) {
  try {
    const ip = req.ip;
    const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';
    const windowSeconds = Math.floor(env.rateLimit.windowMs / 1000);

    const [ipLock, idLock] = await Promise.all([
      evaluateAxis(
        `rl:hits:${actionKey}:ip:${ip}`,
        `rl:lock:${actionKey}:ip:${ip}`,
        `rl:violations:${actionKey}:ip:${ip}`,
        windowSeconds
      ),
      evaluateAxis(
        `rl:hits:${actionKey}:id:${identifier}`,
        `rl:lock:${actionKey}:id:${identifier}`,
        `rl:violations:${actionKey}:id:${identifier}`,
        windowSeconds
      ),
    ]);

    const lockoutSeconds = Math.max(ipLock || 0, idLock || 0);
    return { locked: lockoutSeconds > 0, lockoutSeconds: lockoutSeconds || null };
  } catch (err) {
    logger.error('Rate limiter (recordFailure) error — failing open', {
      error: err.message,
      actionKey,
    });
    return { locked: false, lockoutSeconds: null };
  }
}

/**
 * PATTERN 2c — explicit success resetter (optional but recommended for
 * `login`). Clears BOTH axes' hit counters immediately on a genuine
 * success, so near-miss typos right before a correct password don't
 * linger into the user's next 10-minute window.
 */
async function recordSuccess(req, actionKey, identifierExtractor) {
  try {
    const ip = req.ip;
    const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';
    await Promise.all([
      redisClient.del(`rl:hits:${actionKey}:ip:${ip}`),
      redisClient.del(`rl:hits:${actionKey}:id:${identifier}`),
    ]);
  } catch (err) {
    logger.error('Rate limiter (recordSuccess) error', { error: err.message, actionKey });
  }
}

module.exports = { rateLimit, checkLock, recordFailure, recordSuccess, computeLockoutSeconds };
