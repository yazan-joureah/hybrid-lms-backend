// src/services/kyc/kycReview.service.js
//
// تنفيذ UC-KYC-02 كاملاً: يجلب بيانات Admin طازجة (نفس نمط authController —
// الخدمة تجلب بياناتها بنفسها، لا المتحكم)، يعرض تفاصيل الطلب، يُشغِّل
// EXT-KYC-01 تلقائياً، ويُنفِّذ قرار المراجعة (قبول/رفض).
//
// المراجع: FR-42, FR-45, FR-46, FR-48, FR-48b | MUC-KYC-01, MUC-KYC-03
// ملاحظة: SF-AUTH-03 الكامل (KYC=verified) لا يُطبَّق هنا على الـ Admin
// نفسه — هذا قرار منفصل يخص AUTH ولم يُطلَب مني تعديله؛ أفترض أن طبقة
// الـ Route ستُطبِّق middleware التحقق من الدور/الجلسة قبل الوصول لهذه
// الخدمة، تماماً كما تفعل authRoutes.js حالياً (requireAuth + rateLimit
// على مستوى الـ Route، لا داخل الـ Service).

const User = require('../../models/User');
const KYCRequest = require('../../models/KYCRequest');
const { evaluateAgeDiscrepancy } = require('./ageDiscrepancy.service');
const { grantInstructorPermissions } = require('./kycPermissions.service');
const auditService = require('../auditService');

const REJECTION_REASONS = [
  'UNCLEAR_IMAGE',
  'DOCUMENT_EXPIRED',
  'DATA_MISMATCH',
  'DOCUMENT_NOT_ACCEPTED',
];

/**
 * الدالة 1: جلب طلب واحد للمراجعة مع بيانات صاحبه — تُستخدم في UC-KYC-02
 * خطوة 4 (عرض الوثيقة + Selfie + بيانات الحساب للمراجعة البصرية).
 *
 * @param {string} kycRequestId
 * @returns {Promise<object|null>} - يشمل applicant.birth_date اللازم لاحقاً لـ EXT-KYC-01
 */
async function getRequestForReview(kycRequestId) {
  const kycRequest = await KYCRequest.findById(kycRequestId);
  if (!kycRequest || kycRequest.status !== 'review_pending') {
    // لا نميّز هنا بين "غير موجود" و"ليس بحالة قابلة للمراجعة" في القيمة
    // المُعادة — القرار بين الاثنين يُتَّخذ في الطبقة الأعلى (Controller)
    return null;
  }

  const applicant = await User.findById(kycRequest.user_id);
  if (!applicant) {
    return null;
  }

  return { kycRequest, applicant };
}

/**
 * الدالة 2: تنفيذ قرار "قبول" — UC-KYC-02 المسار الرئيسي حتى خطوة 11،
 * بما فيها استدعاء EXT-KYC-01 داخلياً أولاً (لأن التصنيف يُشغَّل تلقائياً
 * عند كل مراجعة، بصرف النظر عن قرار Admin النهائي — قرار مُثبَّت سلفاً:
 * الدالة حتمية ولا تخضع لتجاوز Admin، منع MUC-KYC-03).
 *
 * @param {object} params
 * @param {string} params.kycRequestId
 * @param {string} params.adminUserId
 * @param {Date} params.documentBirthDate - تاريخ الميلاد المقروء من الوثيقة، يُدخله Admin يدوياً بعد الفحص البصري
 * @param {string} [params.optionalNote]
 * @param {import('express').Request} params.req
 * @returns {Promise<{success: boolean, outcome?: 'verified'|'age_flagged', reason?: string}>}
 */
async function approveKycRequest({
  kycRequestId,
  adminUserId,
  documentBirthDate,
  optionalNote,
  req,
}) {
  const admin = await User.findById(adminUserId);
  if (!admin) {
    return { success: false, reason: 'ADMIN_NOT_FOUND' };
  }
  const adminRole = admin.role;

  const context = await getRequestForReview(kycRequestId);
  if (!context) {
    return { success: false, reason: 'REQUEST_NOT_FOUND_OR_NOT_PENDING' };
  }
  const { kycRequest, applicant } = context;

  // EXT-KYC-01: يُشغَّل دائماً كخطوة تلقائية أولى، بصرف النظر عن نية
  // Admin بالقبول — هذا يمنع أي احتمال لتجاوز الفحص عبر "الموافقة السريعة"
  const ageResult = evaluateAgeDiscrepancy(applicant.birth_date, documentBirthDate);

  if (ageResult.requiresAutoSuspension) {
    // ]a5[ فارق > 2 سنة → يُطلق EXT-KYC-01 فوراً، يتجاوز نية Admin بالقبول
    // تماماً (لا يمكن لـ Admin "الموافقة رغم" هذا التصنيف — حتمي بالكامل)
    kycRequest.status = 'age_flagged';
    kycRequest.age_discrepancy_years = ageResult.discrepancyYears;
    kycRequest.reviewed_by_admin_id = adminUserId;
    kycRequest.reviewed_at = new Date();
    await kycRequest.save();

    await User.findByIdAndUpdate(applicant._id, { kyc_status: 'age_flagged' });

    await auditService.record({
      actorId: adminUserId,
      actorRole: adminRole,
      action: 'KYC_AGE_DISCREPANCY_AUTO_FLAGGED',
      resourceType: 'KYCRequest',
      resourceId: String(kycRequest._id),
      metadata: { discrepancyYears: ageResult.discrepancyYears, tier: ageResult.tier },
      req,
    });

    return { success: true, outcome: 'age_flagged' };
  }

  // فارق أخضر أو أصفر → لا إيقاف للتدفق (الأصفر يُعرَض كتحذير فقط، القرار
  // النهائي يبقى بيد Admin البشري بعد المقارنة البصرية)
  kycRequest.status = 'verified';
  kycRequest.age_discrepancy_years = ageResult.discrepancyYears;
  kycRequest.review_decision_reason = optionalNote || null;
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, { kyc_status: 'verified' });

  // SF-KYC-01 — فقط إذا كان مقدّم الطلب Instructor (استخدام
  // applicant_role المُجمَّد وقت التقديم، وليس applicant.role الحالي —
  // قرار تصميمي مُثبَّت سابقاً في KYCRequest.js)
  if (kycRequest.applicant_role === 'Instructor') {
    await grantInstructorPermissions({
      instructorUserId: applicant._id,
      reviewingAdminId: adminUserId,
      reviewingAdminRole: adminRole,
      req,
    });
  }

  await auditService.record({
    actorId: adminUserId,
    actorRole: adminRole,
    action: 'KYC_REQUEST_APPROVED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { ageTier: ageResult.tier, discrepancyYears: ageResult.discrepancyYears },
    req,
  });

  return { success: true, outcome: 'verified' };
}

/**
 * الدالة 3: تنفيذ قرار "رفض" — UC-KYC-02 امتداد [b7]. سبب إلزامي من قائمة
 * مصنَّفة (وليس نصاً حراً) — يمنع تسريب تفاصيل تقنية غير مقصودة عبر حقل نص حر.
 *
 * @param {object} params
 * @param {string} params.kycRequestId
 * @param {string} params.adminUserId
 * @param {string} params.rejectionReason - يجب أن تكون إحدى REJECTION_REASONS
 * @param {import('express').Request} params.req
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function rejectKycRequest({ kycRequestId, adminUserId, rejectionReason, req }) {
  if (!REJECTION_REASONS.includes(rejectionReason)) {
    return { success: false, reason: 'INVALID_REJECTION_REASON' };
  }

  const admin = await User.findById(adminUserId);
  if (!admin) {
    return { success: false, reason: 'ADMIN_NOT_FOUND' };
  }

  const context = await getRequestForReview(kycRequestId);
  if (!context) {
    return { success: false, reason: 'REQUEST_NOT_FOUND_OR_NOT_PENDING' };
  }
  const { kycRequest, applicant } = context;

  kycRequest.status = 'rejected';
  kycRequest.review_decision_reason = rejectionReason;
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, { kyc_status: 'rejected' });

  await auditService.record({
    actorId: adminUserId,
    actorRole: admin.role,
    action: 'KYC_REQUEST_REJECTED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { rejectionReason },
    req,
  });

  return { success: true };
}

module.exports = {
  getRequestForReview,
  approveKycRequest,
  rejectKycRequest,
  REJECTION_REASONS,
};
