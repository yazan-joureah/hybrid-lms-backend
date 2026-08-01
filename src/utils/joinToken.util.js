const jwt = require('jsonwebtoken');
const { AppError } = require('../middleware/errorHandler');

// SF-LIVE-01: "رمز انضمام موقّع قصير الصلاحية" — دقائق معدودة
const JOIN_TOKEN_TTL_SECONDS = 5 * 60; // 5 دقائق

/**
 * الحصول على المفتاح السري مع قيمة احتياطية وطباعة تحذير في بيئة التطوير
 */
function getJwtSecret() {
  const secret = process.env.JOIN_TOKEN_SECRET || process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '⚠️ [SECURITY WARNING]: JWT Secret is not set in .env! Using fallback secret key.'
      );
    }
    return 'fallback_dev_secret_key_123456';
  }

  return secret;
}

/**
 * SF-LIVE-01 — يوقّع رمز انضمام مرتبط حصراً بـ (studentId + sessionId + courseId)
 */
function signJoinToken({ studentId, sessionId, courseId }) {
  const secret = getJwtSecret();

  const payload = {
    studentId: String(studentId),
    sessionId: String(sessionId),
    type: 'live_join',
  };

  // إضافة courseId إذا تم تمريره
  if (courseId) {
    payload.courseId = String(courseId);
  }

  return jwt.sign(payload, secret, {
    expiresIn: JOIN_TOKEN_TTL_SECONDS,
    algorithm: 'HS256', // SECURITY: قائمة بيضاء صريحة للخوارزمية (منع alg:none)
  });
}

/**
 * يتحقق من رمز الانضمام ويعيد الحمولة. يرمي AppError عند الفشل.
 */
function verifyJoinToken(token) {
  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });

    if (payload.type !== 'live_join') {
      throw new AppError('نوع رمز الانضمام غير صحيح.', 401, 'INVALID_TOKEN_TYPE');
    }

    return payload;
  } catch (err) {
    // إذا كان الخطأ ممرراً أصلاً كـ AppError نعيد رميه مباشرة
    if (err instanceof AppError) throw err;

    throw new AppError('رمز الانضمام غير صالح أو منتهي الصلاحية.', 401, 'INVALID_JOIN_TOKEN');
  }
}

module.exports = {
  signJoinToken,
  verifyJoinToken,
  JOIN_TOKEN_TTL_SECONDS,
};
