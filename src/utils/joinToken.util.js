/**
 * SF-LIVE-01 — Short-lived join token issuance & verification.
 *
 * SECURITY FIX (2026): كان هذا الملف يقرأ `process.env.JWT_SECRET` (متغير غير
 * موجود في .env.example أصلاً) ويسقط على مفتاح احتياطي مكتوب بالكود عند غيابه —
 * ما يعني توقيع كل joinToken بمفتاح ثابت ومعروف للجميع في أي بيئة لم تُضبط فيها
 * تلك المتغيرة. تم إصلاحه بالكامل: نقرأ الآن حصراً من config/env.js المركزي
 * (نفس قاعدة المشروع: "All env vars are read ONCE here"), ونعيد استخدام نفس
 * JWT_ACCESS_SECRET المُتحقَّق منه إلزامياً عند إقلاع السيرفر (env.js يرمي خطأ
 * فوراً إن غاب) — بدون أي قيمة احتياطية غير آمنة.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../middleware/errorHandler');

// SF-LIVE-01: "رمز انضمام موقّع قصير الصلاحية" — دقائق معدودة
const JOIN_TOKEN_TTL_SECONDS = 5 * 60; // 5 دقائق

/**
 * SF-LIVE-01 — يوقّع رمز انضمام مرتبط حصراً بـ (studentId + sessionId + courseId)
 */
function signJoinToken({ studentId, sessionId, courseId }) {
  const payload = {
    studentId: String(studentId),
    sessionId: String(sessionId),
    type: 'live_join',
  };

  if (courseId) {
    payload.courseId = String(courseId);
  }

  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: JOIN_TOKEN_TTL_SECONDS,
    algorithm: 'HS256', // SECURITY: قائمة بيضاء صريحة للخوارزمية (منع alg:none)
  });
}

/**
 * يتحقق من رمز الانضمام ويعيد الحمولة. يرمي AppError عند الفشل.
 */
function verifyJoinToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.accessSecret, {
      algorithms: ['HS256'],
    });

    if (payload.type !== 'live_join') {
      throw new AppError(401, 'INVALID_TOKEN_TYPE', 'نوع رمز الانضمام غير صحيح.');
    }

    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_JOIN_TOKEN', 'رمز الانضمام غير صالح أو منتهي الصلاحية.');
  }
}

module.exports = {
  signJoinToken,
  verifyJoinToken,
  JOIN_TOKEN_TTL_SECONDS,
};
