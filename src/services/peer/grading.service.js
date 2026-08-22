// src/services/peer/grading.service.js
// UC-PEER-04 — Calculate Final Peer Grade & Alert Instructor

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');

// UC-PEER-04 خطوة 4 — فارق أعلى/أدنى درجة بين المراجعين يتجاوز 20% من المهمة
const GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT = 20;

/**
 * UC-PEER-04 — يُحسَب تلقائياً (Cron) عند انتهاء مهلة المراجعة، أو يدوياً
 * كخيار احتياطي من المحاضر/الإدارة. Idempotent: لا يُعاد الاحتساب لمهمة
 * أُكمِلت بالفعل (status === 'completed').
 */
async function calculateFinalGrades({ assignmentId, actorId = null, actorRole = 'System', req = null }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة.');
  }

  if (assignment.status === 'completed') {
    return { success: true, data: { assignment, alreadyCompleted: true } };
  }
  if (assignment.status !== 'distributed') {
    throw new AppError(400, 'NOT_DISTRIBUTED_YET', 'لم تُوزَّع المراجعات لهذه المهمة بعد.');
  }
  if (new Date() < assignment.reviewDeadline) {
    throw new AppError(400, 'REVIEW_STILL_OPEN', 'لم تنتهِ مهلة المراجعة بعد.');
  }

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId });
  const flaggedSubmissionIds = [];
  const bulkOps = [];

  for (const submission of submissions) {
    const reviews = await PeerReview.find({ submissionId: submission._id }).lean();
    // [a2] "لم يُكمل قبل انتهاء المهلة → تُستبعَد درجته، تُحسَب من الباقين"
    const completedReviews = reviews.filter((r) => r.status === 'completed');

    if (completedReviews.length === 0) {
      // [b2] "لم يُكمل أي مراجِع → إشعار للمحاضر لاتخاذ إجراء يدوي"
      bulkOps.push({
        updateOne: {
          filter: { _id: submission._id },
          update: {
            $set: {
              finalScore: null,
              finalScorePercentage: null,
              gradingFlagged: true,
              gradingFlagReason: 'NO_REVIEWER_COMPLETED',
            },
          },
        },
      });
      flaggedSubmissionIds.push(submission._id.toString());
      continue;
    }

    const scores = completedReviews.map((r) => r.totalScore);
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const variancePercent = maxScore - minScore; // النطاق كامل بالفعل بوحدة % (0-100)

    const flagged = variancePercent > GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT;

    bulkOps.push({
      updateOne: {
        filter: { _id: submission._id },
        update: {
          $set: {
            finalScore: Math.round(average * 100) / 100,
            finalScorePercentage: Math.round(average * 100) / 100,
            gradingFlagged: flagged,
            gradingFlagReason: flagged ? 'REVIEWER_VARIANCE_EXCEEDS_THRESHOLD' : null,
          },
        },
      },
    });

    if (flagged) {
      flaggedSubmissionIds.push(submission._id.toString());
    }
  }

  if (bulkOps.length > 0) {
    await PeerSubmission.bulkWrite(bulkOps);
  }

  assignment.status = 'completed';
  assignment.completedAt = new Date();
  await assignment.save();

  await auditService.record({
    actorId,
    actorRole,
    action: 'PEER_FINAL_GRADES_CALCULATED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: { submissionCount: submissions.length, flaggedCount: flaggedSubmissionIds.length },
    req,
  });

  // TODO(email): إشعار المحاضر بالتفاصيل لكل submission مُعلَّمة (UC-PEER-04 خطوة 4)

  return {
    success: true,
    data: { assignment, submissionCount: submissions.length, flaggedSubmissionIds },
  };
}

/**
 * الطالب: يرى درجته النهائية + ملاحظات المراجعين (بلا هوياتهم)
 * المحاضر/الإدارة: يرى تفصيلاً كاملاً لكل الطلاب
 */
async function getGradeSummary({ userId, role, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة.');
  }

  if (role === 'Student') {
    const submission = await PeerSubmission.findOne({
      assignmentId: safeAssignmentId,
      studentId: userId,
    }).lean();
    if (!submission) {
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'لا يوجد تسليم لك في هذه المهمة.');
    }

    const reviews = await PeerReview.find({
      submissionId: submission._id,
      status: 'completed',
    })
      .select('scores feedbackText totalScore') // بلا reviewerId إطلاقاً — إخفاء الهوية دائم
      .lean();

    return {
      success: true,
      data: {
        finalScore: submission.finalScore,
        finalScorePercentage: submission.finalScorePercentage,
        reviews,
      },
    };
  }

  // Instructor / Admin
  if (role === 'Instructor' && assignment.instructorId.toString() !== userId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية الاطلاع على درجات هذه المهمة.');
  }

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId })
    .populate('studentId', 'full_name email')
    .lean();

  return { success: true, data: { submissions } };
}

module.exports = { calculateFinalGrades, getGradeSummary, GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT };
