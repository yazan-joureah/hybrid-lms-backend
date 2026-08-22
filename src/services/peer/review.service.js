// src/services/peer/review.service.js
// UC-PEER-03 — Submit Peer Review

const PeerReview = require('../../models/peerReview.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerAssignment = require('../../models/peerAssignment.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const fileStorage = require('../fileStorage.service');
const auditService = require('../auditService');

/**
 * UC-PEER-03 خطوة 1-2 — يعرض للطالب قائمة مهام المراجعة المسنَدة إليه ضمن مهمة
 * معيّنة، بلا أي كشف لهوية صاحب العمل (Hash مؤقت فقط — هنا: "عمل رقم N").
 */
async function listMyReviewTasks({ reviewerId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const safeReviewerId = toObjectId(reviewerId, 'reviewerId');

  const reviews = await PeerReview.find({
    assignmentId: safeAssignmentId,
    reviewerId: safeReviewerId,
  })
    .populate({ path: 'submissionId', select: 'displaySequentialId submittedAt' })
    .sort({ createdAt: 1 })
    .lean();

  // تنقية صريحة: لا نُعيد أي حقل قد يكشف هوية صاحب التسليم عن طريق الخطأ
  const sanitized = reviews.map((r) => ({
    reviewId: r._id,
    status: r.status,
    submittedAt: r.submittedAt,
    submissionDisplayId: r.submissionId?.displaySequentialId ?? null,
    submissionSubmittedAt: r.submissionId?.submittedAt ?? null,
  }));

  return { success: true, data: { reviews: sanitized } };
}

/**
 * UC-PEER-03 خطوة 2 — يجلب محتوى التسليم (نص/رابط تنزيل الملف) الذي على
 * الطالب مراجعته — بعد التحقق الصارم أن هذا المستخدم هو المراجِع المُسنَد
 * فعلياً لهذا التسليم تحديداً (منع IDOR — لا يمكن تخمين submissionId ورؤيته).
 */
async function getReviewSubmissionContent({ reviewerId, reviewId }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId).populate('submissionId');

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'مهمة المراجعة غير موجودة.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لست المراجِع المُسنَد لهذه المهمة.');
  }

  const submission = review.submissionId;
  let downloadUrl = null;
  if (submission.fileId) {
    // لا نعيد fileId الخام (قد يُستخدَم للوصول المباشر لـ GridFS) — بل مساراً
    // مخصَّصاً يمر عبر نفس فحص الصلاحية أعلاه في كل مرة (راجع الكونترولر)
    downloadUrl = `/api/v1/peer/reviews/${safeReviewId}/submission/download`;
  }

  return {
    success: true,
    data: {
      displaySequentialId: submission.displaySequentialId,
      textContent: submission.textContent,
      downloadUrl,
      hasFile: Boolean(submission.fileId),
    },
  };
}

/** يفتح تدفق تنزيل ملف التسليم — بعد نفس فحص الصلاحية أعلاه بالضبط */
async function streamReviewSubmissionFile({ reviewerId, reviewId }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId).populate('submissionId');

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'مهمة المراجعة غير موجودة.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لست المراجِع المُسنَد لهذه المهمة.');
  }
  if (!review.submissionId.fileId) {
    throw new AppError(404, 'NO_FILE_ATTACHED', 'لا يوجد ملف مرفق بهذا التسليم.');
  }

  return fileStorage.getDownloadStream({ fileId: review.submissionId.fileId });
}

/**
 * UC-PEER-03 خطوة 5-6 — يحفظ تقييم الطالب (الدرجات لكل محور + الملاحظات النصية)
 */
async function submitReview({ reviewerId, reviewId, scores, feedbackText, req }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId);

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'مهمة المراجعة غير موجودة.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لست المراجِع المُسنَد لهذه المهمة.');
  }

  const assignment = await PeerAssignment.findById(review.assignmentId).lean();
  if (new Date() > assignment.reviewDeadline) {
    throw new AppError(400, 'REVIEW_DEADLINE_PASSED', 'انتهت مهلة المراجعة.');
  }

  // [a5] "يجب تقييم جميع المحاور قبل الإرسال"
  const requiredCriteria = assignment.rubric.map((r) => r.criterion);
  const providedCriteria = scores.map((s) => s.criterion);
  const missing = requiredCriteria.filter((c) => !providedCriteria.includes(c));
  if (missing.length > 0) {
    throw new AppError(
      400,
      'INCOMPLETE_RUBRIC',
      `يجب تقييم كل المحاور قبل الإرسال. المحاور الناقصة: ${missing.join(', ')}`
    );
  }

  // احتساب مجموع مرجَّح حسب أوزان الـ Rubric المُعرَّفة في المهمة (وليس المُرسَلة
  // من العميل — يُقرأ وزن/أقصى-درجة كل محور من assignment.rubric حصراً)
  let totalScore = 0;
  for (const criterionDef of assignment.rubric) {
    const provided = scores.find((s) => s.criterion === criterionDef.criterion);
    const normalizedScore = Math.min(Math.max(provided.score, 0), criterionDef.maxScore);
    totalScore += (normalizedScore / criterionDef.maxScore) * criterionDef.weight * 100;
  }

  review.scores = scores;
  review.feedbackText = feedbackText || null;
  review.totalScore = Math.round(totalScore * 100) / 100; // نسبة مئوية من 100
  review.status = 'completed';
  review.submittedAt = new Date();
  await review.save();

  await auditService.record({
    actorId: reviewerId,
    actorRole: 'Student',
    action: 'PEER_REVIEW_SUBMITTED',
    resourceType: 'PeerReview',
    resourceId: review._id.toString(),
    metadata: { assignmentId: review.assignmentId.toString(), totalScore: review.totalScore },
    req,
  });

  return { success: true, data: { review } };
}

module.exports = { listMyReviewTasks, getReviewSubmissionContent, streamReviewSubmissionFile, submitReview };
