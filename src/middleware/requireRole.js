// src/middleware/requireRole.js
//
// Middleware مشترك للتحقق من دور المستخدم — عابر للوحدات (KYC، COURSE،
// PAY، REPORT، إلخ)، وليس مقيَّداً بـ KYC. يُستخدم دائماً بعد requireAuth
// مباشرة على مستوى الـ Route (نفس ترتيب middleware في authRoutes.js).
//
// المرجع: FR-34, FR-05 | OWASP A01 — Broken Access Control
//
// قرار تصميمي: الدور يُستعلَم طازجاً من قاعدة البيانات في كل طلب (وليس
// من الـ JWT في req.user)، لأن authMiddleware.js يضع فقط {id, sessionId}
// عمداً — هذا الملف يكمل ذلك القرار بدل مخالفته. نعم هذا يعني استعلام DB
// إضافي لكل طلب محمي بدور، وهو نفس الكلفة المقبولة أصلاً في SF-AUTH-01
// الموصوف في وثائق UC (كل استدعاء لها يستعلم الدور من الخادم، لا يُصادَق
// على أي دور من الطلب).
//
// اعتبار أمني إضافي: لا نُفرِّق بين "المستخدم غير موجود" و"المستخدم
// موجود لكن دوره غير مصرَّح" في رسالة الخطأ — كلاهما 403 بنفس الشكل،
// لمنع أي تسريب معلوماتي (نفس منطق User Enumeration Prevention المُتَّبع
// في AUTH).

const User = require('../models/User');

/**
 * @param {string[]} allowedRoles - مثال: ['Admin', 'SuperAdmin']
 * @returns {import('express').RequestHandler}
 */
function requireRole(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    // خطأ برمجي وقت التطوير (استخدام خاطئ للـ middleware نفسه)، وليس
    // حالة تشغيلية — فشل فوري وصريح بدل سلوك غامض لاحقاً
    throw new Error('requireRole() requires a non-empty array of allowed roles');
  }

  return async function roleCheckMiddleware(req, res, next) {
    // يجب أن يُستخدَم هذا الـ middleware دائماً بعد requireAuth — إن لم
    // يكن req.user.id موجوداً، هذا خطأ في ترتيب الـ middleware في الـ
    // Route نفسها، وليس حالة مستخدم غير مصادَق
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Authentication is required before role check.' },
      });
    }

    const user = await User.findById(req.user.id).select('role status').lean();

    // نفس رسالة 403 لكل الحالات غير المصرَّحة، بصرف النظر عن السبب
    // الداخلي (المستخدم محذوف؟ دوره غير مطابق؟ حسابه معلَّق؟) — منع
    // تسريب أي إشارة تفصيلية للمهاجم المحتمل
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
      });
    }

    // ملاحظة: لا نتحقق هنا من status==='active' — هذا قرار مقصود، لأن
    // بعض الوحدات (مثل استعادة حساب مُعلَّق) قد تحتاج السماح لأدوار
    // معيّنة بالعمل حتى مع حالات حساب أخرى. أي وحدة تحتاج فرض active
    // إضافياً يجب أن تُركِّب ذلك صراحة (مثل SF-AUTH-03 الكامل)، وليس
    // ضمنياً هنا.
    req.verifiedRole = user.role; // متاحة للطبقات التالية بلا استعلام DB مكرر
    return next();
  };
}

module.exports = { requireRole };
