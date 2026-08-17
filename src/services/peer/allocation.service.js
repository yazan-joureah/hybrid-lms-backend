// src/services/peer/allocation.service.js
// UC-PEER-02 — Anonymize & Distribute Peer Review

const mongoose = require('mongoose');
const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');

// حد أدنى لعدد التسليمات كي يكون التوزيع العشوائي المتقاطع ذا معنى فعلياً
// (بأقل من هذا العدد، يصعب تفادي التكرار أو التبادل الثنائي إحصائياً)
const MIN_SUBMISSIONS_FOR_DISTRIBUTION = 3;

/**
 * خوارزمية التوزيع: لكل طالب i، يُعيَّن كمراجِعين لتسليمه الطلاب
 * عند الإزاحات (offsets) 1..N على دائرة عشوائية الترتيب — هذا يضمن تلقائياً:
 * (أ) لا طالب يراجع تسليم نفسه (offset لا يساوي 0 أبداً).
 * (ب) لا تبادل ثنائي متزامن (A يراجع B وB يراجع A في نفس الدورة) طالما
 *     الإزاحات المستخدَمة لا تتضمن زوجاً متكاملاً (k وlength-k معاً) —
 *     نضمن ذلك بقصر الإزاحات المسموحة على النصف الأول من الدائرة عملياً.
 *
 * @returns {Array<{ submissionIndex: number, reviewerIndices: number[] }>}
 */
function buildCrossAllocation(submissionCount, reviewersPerSubmission) {
  const maxSafeReviewers = Math.floor((submissionCount - 1) / 2);
  const effectiveReviewers = Math.min(reviewersPerSubmission, maxSafeReviewers || 1);

  const allocation = [];
  for (let i = 0; i < submissionCount; i += 1) {
    const reviewerIndices = [];
    for (let offset = 1; offset <= effectiveReviewers; offset += 1) {
      reviewerIndices.push((i + offset) % submissionCount);
    }
    allocation.push({ submissionIndex: i, reviewerIndices });
  }
  return { allocation, effectiveReviewers };
}

/** خلط Fisher-Yates عشوائي آمن — نفس النمط الموثَّق في SF-QUIZ-02 لخلط الأسئلة */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * UC-PEER-02 — يُخفي الهويات، يوزّع المراجعات عشوائياً بشكل متقاطع، ويُنشئ
 * سجلات PeerReview بحالة 'assigned'. Idempotent: لا يُعاد التوزيع لمهمة
 * وُزِّعت بالفعل (status !== 'open').
 *
 * @param {object} params
 * @param {string} params.assignmentId
 * @param {string|null} params.actorId - null إن استُدعيت من Cron (System)
 * @param {string} params.actorRole - 'System' | 'Instructor' | 'Admin'
 */
async function distributeReviews({ assignmentId, actorId = null, actorRole = 'System', req = null }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة.');
  }

  if (assignment.status !== 'open') {
    // Idempotent — إعادة استدعاء (من Cron مثلاً) على مهمة وُزِّعت بالفعل لا تفعل شيئاً
    return { success: true, data: { assignment, alreadyDistributed: true } };
  }

  if (new Date() < assignment.submissionDeadline) {
    throw new AppError(400, 'SUBMISSION_STILL_OPEN', 'لم تنتهِ مهلة التسليم بعد.');
  }

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId });

  if (submissions.length < MIN_SUBMISSIONS_FOR_DISTRIBUTION) {
    await auditService.record({
      actorId,
      actorRole,
      action: 'PEER_DISTRIBUTION_FAILED_INSUFFICIENT_SUBMISSIONS',
      resourceType: 'PeerAssignment',
      resourceId: safeAssignmentId.toString(),
      metadata: { submissionCount: submissions.length },
      req,
    });
    throw new AppError(
      400,
      'INSUFFICIENT_SUBMISSIONS',
      `عدد التسليمات (${submissions.length}) غير كافٍ للتوزيع العشوائي المتقاطع (الحد الأدنى ${MIN_SUBMISSIONS_FOR_DISTRIBUTION}).`
    );
  }

  // ترتيب عشوائي أولاً (كي لا يكون "عمل رقم 1" دائماً لأول من سلَّم زمنياً)
  const shuffledSubmissions = shuffle(submissions);

  const { allocation, effectiveReviewers } = buildCrossAllocation(
    shuffledSubmissions.length,
    assignment.reviewersPerSubmission
  );

  // UC-PEER-02 خطوة 2 — إخفاء الهوية عبر "عمل رقم N" تسلسلي
  const bulkSubmissionOps = shuffledSubmissions.map((sub, index) => ({
    updateOne: {
      filter: { _id: sub._id },
      update: { $set: { displaySequentialId: index + 1 } },
    },
  }));
  await PeerSubmission.bulkWrite(bulkSubmissionOps);

  const reviewDocs = [];
  for (const { submissionIndex, reviewerIndices } of allocation) {
    const submission = shuffledSubmissions[submissionIndex];
    for (const reviewerIdx of reviewerIndices) {
      const reviewerSubmission = shuffledSubmissions[reviewerIdx];
      reviewDocs.push({
        assignmentId: safeAssignmentId,
        submissionId: submission._id,
        reviewerId: reviewerSubmission.studentId, // المراجِع = صاحب التسليم عند هذا الفهرس
        status: 'assigned',
      });
    }
  }

  // insertMany بترتيب غير إلزامي (ordered:false) — لو استُدعيت الدالة مرتين
  // بالتزامن (سباق نادر بين Cron ومحاضر يدوي)، القيد الفريد في النموذج
  // يرفض التكرارات بصمت بدل فشل العملية كاملة.
  try {
    await PeerReview.insertMany(reviewDocs, { ordered: false });
  } catch (err) {
    if (err.code !== 11000) throw err; // 11000 = duplicate key فقط هو المتوقَّع هنا
  }

  assignment.status = 'distributed';
  assignment.distributedAt = new Date();
  await assignment.save();

  await auditService.record({
    actorId,
    actorRole,
    action: 'PEER_REVIEWS_DISTRIBUTED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: {
      submissionCount: shuffledSubmissions.length,
      reviewersPerSubmission: effectiveReviewers,
      totalReviewsCreated: reviewDocs.length,
    },
    req,
  });

  // TODO(email): إشعار كل مراجِع بمهام المراجعة الموكَلة إليه (UC-PEER-02 خطوة 6)

  return {
    success: true,
    data: { assignment, submissionCount: shuffledSubmissions.length, reviewCount: reviewDocs.length },
  };
}

module.exports = { distributeReviews, buildCrossAllocation, MIN_SUBMISSIONS_FOR_DISTRIBUTION };
