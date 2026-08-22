// src/services/peer/submission.service.js
// مرحلة التسليم — سابقة لـ UC-PEER-02 (شرط مسبق له في التوثيق الأصلي)

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { validateUploadedFile } = require('../../utils/fileValidation.util');
const fileStorage = require('../fileStorage.service');
const auditService = require('../auditService');

// كل وحدة (COURSE، LIVE، والآن PEER) تُعرِّف قائمتها البيضاء وحدّها الأقصى
// محلياً في خدمتها الخاصة — نفس المبدأ الموثَّق في معيار المشروع (بند 7).
const PEER_SUBMISSION_ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const PEER_SUBMISSION_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // قيد Atlas M0 نفسه

/**
 * تسليم (أو إعادة تسليم) حل الطالب — idempotent حتى موعد الإغلاق.
 */
async function submitAssignment({ studentId, assignmentId, textContent, file, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');

  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة.');
  }

  if (assignment.status !== 'open') {
    throw new AppError(400, 'SUBMISSIONS_CLOSED', 'أُغلق باب التسليم لهذه المهمة.');
  }
  if (new Date() > assignment.submissionDeadline) {
    throw new AppError(400, 'SUBMISSION_DEADLINE_PASSED', 'انتهت مهلة التسليم.');
  }

  const enrolled = await Enrollment.findOne({
    student_id: safeStudentId,
    course_id: assignment.courseId,
    status: 'active',
  }).lean();
  if (!enrolled) {
    await auditService.record({
      actorId: safeStudentId,
      actorRole: 'Student',
      action: 'PEER_SUBMISSION_UNAUTHORIZED_ATTEMPT',
      resourceType: 'PeerAssignment',
      resourceId: safeAssignmentId.toString(),
      metadata: {},
      req,
    });
    throw new AppError(403, 'NOT_ENROLLED', 'غير مسجل في كورس هذه المهمة.');
  }

  if (!textContent && !file) {
    throw new AppError(400, 'EMPTY_SUBMISSION', 'يجب إرفاق نص أو ملف على الأقل.');
  }

  const update = {
    assignmentId: safeAssignmentId,
    studentId: safeStudentId,
    courseId: assignment.courseId,
    submittedAt: new Date(),
  };

  if (textContent) {
    update.textContent = textContent;
  }

  if (file && file.buffer) {
    const validation = await validateUploadedFile(file.buffer, file.originalname, {
      allowedMimeTypes: PEER_SUBMISSION_ALLOWED_MIME_TYPES,
      maxFileSizeBytes: PEER_SUBMISSION_MAX_FILE_SIZE_BYTES,
    });
    if (!validation.valid) {
      throw new AppError(400, validation.reason, 'فشل التحقق من الملف المرفوع.');
    }

    const { fileId, storagePath } = await fileStorage.uploadFile({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: validation.detectedMime,
      sizeBytes: file.buffer.length,
      userId: safeStudentId,
      actorRole: 'Student',
      req,
      metadata: { assignmentId: safeAssignmentId.toString(), context: 'peer_submission' },
    });

    update.fileId = fileId;
    update.storagePath = storagePath;
  }

  // Idempotent: تسليم واحد فقط لكل (مهمة، طالب) — إعادة التسليم تُحدِّث نفس السجل
  const submission = await PeerSubmission.findOneAndUpdate(
    { assignmentId: safeAssignmentId, studentId: safeStudentId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'PEER_ASSIGNMENT_SUBMITTED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: { submissionId: submission._id.toString(), hasFile: Boolean(file) },
    req,
  });

  return { success: true, data: { submission } };
}

/** يعرض للطالب حالة تسليمه الخاص لمهمة معيّنة (موجود؟ متى؟) */
async function getMySubmission({ studentId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const submission = await PeerSubmission.findOne({
    assignmentId: safeAssignmentId,
    studentId,
  }).lean();

  return { success: true, data: { submission: submission || null } };
}

module.exports = {
  submitAssignment,
  getMySubmission,
  PEER_SUBMISSION_ALLOWED_MIME_TYPES,
  PEER_SUBMISSION_MAX_FILE_SIZE_BYTES,
};
