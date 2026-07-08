/**
 * Dual-axis rate limiting (per IP + per identifier) with Android-style
 * exponential backoff lockout. Source: NFR-03.
 *
 * Design decision (2026 — supersedes Cloudflare Turnstile approach):
 * No external CAPTCHA challenge is used. Instead, repeated violations are
 * met with a self-expiring lockout whose duration DOUBLES each time the
 * same IP or identifier re-offends, capped at a maximum (OWASP Testing
 * Guide recommends 5–30 min). This mirrors Android's failed-unlock pattern
 * (30s, 1min, 2min, ...) and requires zero third-party services or API
 * keys (principle #7/#8).
 *
 * Security note: the lockout is time-bound and never permanent, and keys
 * off BOTH IP and identifier — this avoids the "weaponized lockout" DoS
 * vector (an attacker deliberately failing a victim's identifier to lock
 * them out indefinitely), since IP-side throttling also applies and every
 * lock self-expires regardless of further requests.
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

      // Step 1 — cheap read-only check: are we already inside an active lock?
      const [ipLockedFor, idLockedFor] = await Promise.all([
        secondsRemainingIfLocked(ipLockKey),
        secondsRemainingIfLocked(idLockKey),
      ]);
      const alreadyLockedFor = Math.max(ipLockedFor || 0, idLockedFor || 0);
      if (alreadyLockedFor > 0) {
        return rejectLocked(res, alreadyLockedFor);
      }

      // Step 2 — count this request on both axes; escalate to a lock if
      // either axis just crossed its threshold.
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

module.exports = { rateLimit, computeLockoutSeconds };
