//Dual-axis rate limiting (per IP + per identifier) with Android-style

const redisClient = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');

const DEFAULT_AXIS_CONFIG = {
  maxAttempts: env.rateLimit.maxAttempts,
  windowSeconds: Math.floor(env.rateLimit.windowMs / 1000),
};

const AXIS_OVERRIDES = {
  login: {
    ip: { maxAttempts: 20, windowSeconds: 10 * 60 },
    id: { maxAttempts: 15, windowSeconds: 60 * 60 },
  },
  'mfa-login-verify': {
    ip: { maxAttempts: 20, windowSeconds: 10 * 60 },
  },
};

function resolveAxisConfig(actionKey, axis) {
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
  resolveAxisConfig,
};
