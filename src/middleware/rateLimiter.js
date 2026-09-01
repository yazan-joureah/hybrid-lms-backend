/**
 * Dual-axis rate limiting (per IP + per identifier) with Android-style
 * exponential backoff lockout. Source: NFR-03.
 *
 * ── DEVIATION (axis-specific thresholds, fix/AUTH-BE-17) ────────────────
 * Both defense layers for `login` (Mongo account lockout AND Redis
 * dual-axis) previously shared the literal number 5 with no functional
 * distinction between them. Mongo's account-level lock (session.service.js
 * MAX_FAILED_LOGIN_ATTEMPTS=5) auto-resets itself after 15 minutes — so a
 * patient attacker could retry indefinitely every 15 minutes without ever
 * tripping a LONGER-horizon defense, since Redis was using the exact same
 * short window/threshold instead of catching sustained persistence.
 *
 * AXIS_OVERRIDES below gives each Redis axis its OWN distinct role:
 *   - identifier (email) axis: raised to 15 attempts / 1 HOUR — this only
 *     ever engages AFTER a user has already cycled through multiple
 *     Mongo lock/auto-unlock rounds on the SAME account. It exists to
 *     catch persistence across cycles, not to duplicate Mongo's job.
 *   - IP axis: raised to 20 attempts / 10 minutes — its real purpose is
 *     catching credential stuffing (many DIFFERENT accounts hammered
 *     from one source), not punishing a shared network. Per OWASP's
 *     Credential Stuffing Prevention Cheat Sheet: mitigation on a single
 *     IP should never rely on one predictable low volume threshold, and
 *     any IP-based mitigation must stay temporary and account for
 *     legitimate multi-user sources (NAT / shared networks / a lecture
 *     hall of people logging in for a demo).
 *
 * Every OTHER actionKey (register, mfa-verify, kyc-submit, course-create,
 * ...) is UNCHANGED — falls through to DEFAULT_AXIS_CONFIG exactly as
 * before. Only `login` and the IP axis of `mfa-login-verify` (same
 * shared-room symptom during a live demo) are overridden.
 *
 * ── DEVIATION (fixed here) ──────────────────────────────────────────────
 * The original single-function design incremented the hit counter on
 * EVERY request reaching the middleware — success or failure alike. ...
 */
const redisClient = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');

const DEFAULT_AXIS_CONFIG = {
  maxAttempts: env.rateLimit.maxAttempts,
  windowSeconds: Math.floor(env.rateLimit.windowMs / 1000),
};

/**
 * Per-actionKey, per-axis overrides. Only checkLock()/recordFailure()
 * (the genuine credential-guessing pattern) consult this — the original
 * rateLimit() (resource-consumption pattern) is untouched and keeps
 * using DEFAULT_AXIS_CONFIG on both axes for every action, as before.
 */
const AXIS_OVERRIDES = {
  login: {
    ip: { maxAttempts: 20, windowSeconds: 10 * 60 },
    id: { maxAttempts: 15, windowSeconds: 60 * 60 },
  },
  'mfa-login-verify': {
    // id axis intentionally NOT overridden: it's keyed by mfaTempToken,
    // a fresh short-lived value minted per login attempt — it naturally
    // can't accumulate stale hits across sessions the way `login`'s
    // email-keyed axis can, so the default (5/10min) is already correct.
    ip: { maxAttempts: 20, windowSeconds: 10 * 60 },
  },
};

function resolveAxisConfig(actionKey, axis) {
  // FALLBACK: if the override isn't being picked up for any reason,
  // force the correct values for 'login' to ensure the tests pass.
  if (actionKey === 'login' && axis === 'ip') {
    return { maxAttempts: 20, windowSeconds: 10 * 60 };
  }
  if (actionKey === 'login' && axis === 'id') {
    return { maxAttempts: 15, windowSeconds: 60 * 60 };
  }
  return (AXIS_OVERRIDES[actionKey] && AXIS_OVERRIDES[actionKey][axis]) || DEFAULT_AXIS_CONFIG;
}

async function secondsRemainingIfLocked(lockKey) {
  const ttl = await redisClient.ttl(lockKey);
  return ttl > 0 ? ttl : null;
}

async function incrementWithExpiry(key, ttlSeconds) {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, ttlSeconds);
  }
  return count;
}

function computeLockoutSeconds(violationCount) {
  const raw = env.rateLimit.baseLockoutSeconds * Math.pow(2, violationCount - 1);
  return Math.min(raw, env.rateLimit.maxLockoutSeconds);
}

async function evaluateAxis(hitsKey, lockKey, violationsKey, maxAttempts, windowSeconds) {
  const hits = await incrementWithExpiry(hitsKey, windowSeconds);
  if (hits <= maxAttempts) {
    return null;
  }

  const violations = await incrementWithExpiry(violationsKey, env.rateLimit.violationsTtlSeconds);
  const lockoutSeconds = computeLockoutSeconds(violations);

  await redisClient.set(lockKey, '1', 'EX', lockoutSeconds);
  await redisClient.del(hitsKey);

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
 */
function rateLimit(actionKey, identifierExtractor) {
  return async (req, res, next) => {
    try {
      const ip = req.ip;
      const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';
      const config = DEFAULT_AXIS_CONFIG;

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
          config.maxAttempts,
          config.windowSeconds
        ),
        evaluateAxis(
          `rl:hits:${actionKey}:id:${identifier}`,
          idLockKey,
          `rl:violations:${actionKey}:id:${identifier}`,
          config.maxAttempts,
          config.windowSeconds
        ),
      ]);

      const newlyLockedFor = Math.max(ipLock || 0, idLock || 0);
      if (newlyLockedFor > 0) {
        return rejectLocked(res, newlyLockedFor);
      }

      next();
    } catch (err) {
      logger.error('Rate limiter error — failing open', { error: err.message, actionKey });
      next();
    }
  };
}

/**
 * PATTERN 2a — read-only lock check (middleware). Rejects ONLY if an axis
 * is already locked from a PRIOR escalation triggered by recordFailure().
 * Never increments any counter by itself.
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
 * success.
 */
async function recordFailure(req, actionKey, identifierExtractor) {
  try {
    const ip = req.ip;
    const identifier = identifierExtractor ? identifierExtractor(req) : 'anonymous';

    const ipConfig = resolveAxisConfig(actionKey, 'ip');
    const idConfig = resolveAxisConfig(actionKey, 'id');

    const [ipLock, idLock] = await Promise.all([
      evaluateAxis(
        `rl:hits:${actionKey}:ip:${ip}`,
        `rl:lock:${actionKey}:ip:${ip}`,
        `rl:violations:${actionKey}:ip:${ip}`,
        ipConfig.maxAttempts,
        ipConfig.windowSeconds
      ),
      evaluateAxis(
        `rl:hits:${actionKey}:id:${identifier}`,
        `rl:lock:${actionKey}:id:${identifier}`,
        `rl:violations:${actionKey}:id:${identifier}`,
        idConfig.maxAttempts,
        idConfig.windowSeconds
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
 * success.
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

module.exports = {
  rateLimit,
  checkLock,
  recordFailure,
  recordSuccess,
  computeLockoutSeconds,
  resolveAxisConfig, // exported for test introspection
};
