// src/services/peer/assignment.service.js

const PeerAssignment = require('../../models/peerAssignment.model');
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const Enrollment = require('../../models/Enrollment');
const PeerSubmission = require('../../models/peerSubmission.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { ensureAssignmentUpToDate } = require('./lifecycle.service');
const { loadOwnedResource } = require('../../utils/ownedResource.util');

const UPDATABLE_FIELDS = [
  'title',
  'description',
  'rubric',
  'submissionDeadline',
  'reviewDeadline',
  'reviewersPerSubmission',
  'allowFileSubmission',
  'maxAttempts',
];
async function loadOwnedAssignment(assignmentId, instructorId, { req, unauthorizedAction } = {}) {
  return loadOwnedResource({
    model: PeerAssignment,
    resourceId: assignmentId,
    actorId: instructorId,
    ownerField: 'instructorId',
    resourceType: 'PeerAssignment',
    notFoundCode: 'ASSIGNMENT_NOT_FOUND',
    notFoundMessage: 'Assignment not found.',
    forbiddenMessage: 'You do not have permission to manage this assignment.',
    unauthorizedAction,
    req,
  });
}

function assertAssignmentEditable(assignment) {
  if (assignment.status !== 'open') {
    throw new AppError(
      409,
      'ASSIGNMENT_LOCKED',
      'This assignment cannot be modified after review distribution has started.'
    );
  }
}

async function assertInstructorOwnsCourse({ instructorId, courseId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== instructorId.toString()) {
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_PEER_ASSIGNMENT_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: courseId.toString(),
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to manage this course.');
  }
  return course;
}

//Create a new peer assessment task.
async function createAssignment({ instructorId, assignmentData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(assignmentData.courseId, 'courseId');

  await assertInstructorOwnsCourse({ instructorId: safeInstructorId, courseId: safeCourseId, req });

  // Both deadlines are optional — we only validate if the instructor provided a value.
  const submissionDeadline = assignmentData.submissionDeadline
    ? new Date(assignmentData.submissionDeadline)
    : null;
  const reviewDeadline = assignmentData.reviewDeadline
    ? new Date(assignmentData.reviewDeadline)
    : null;
  const now = new Date();

  if (submissionDeadline && submissionDeadline <= now) {
    throw new AppError(
      400,
      'INVALID_SUBMISSION_DEADLINE',
      'Submission deadline must be in the future.'
    );
  }
  if (reviewDeadline && !submissionDeadline) {
    throw new AppError(
      400,
      'INVALID_REVIEW_DEADLINE',
      'Cannot set a review deadline without a submission deadline.'
    );
  }

  if (reviewDeadline && submissionDeadline && reviewDeadline <= submissionDeadline) {
    throw new AppError(
      400,
      'INVALID_REVIEW_DEADLINE',
      'The review deadline must come after the submission deadline.'
    );
  }

  // unitId is completely optional.
  let safeUnitId = null;
  if (assignmentData.unitId) {
    safeUnitId = toObjectId(assignmentData.unitId, 'unitId');
    const unit = await CourseUnit.findById(safeUnitId);
    if (!unit || !unit.course_id.equals(safeCourseId)) {
      throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found in this course.');
    }
  }

  const assignment = await PeerAssignment.create({
    courseId: safeCourseId,
    instructorId: safeInstructorId,
    unitId: safeUnitId,
    title: assignmentData.title,
    description: assignmentData.description || '',
    rubric: assignmentData.rubric,
    submissionDeadline,
    reviewDeadline,
    reviewersPerSubmission: assignmentData.reviewersPerSubmission || 2,
    allowFileSubmission: assignmentData.allowFileSubmission !== false,
    maxAttempts: assignmentData.maxAttempts || 3,
    status: 'open',
  });

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'PEER_ASSIGNMENT_CREATED',
    resourceType: 'PeerAssignment',
    resourceId: assignment._id.toString(),
    metadata: { courseId: safeCourseId.toString(), submissionDeadline, reviewDeadline },
    req,
  });

  const { assignment: refreshed, pendingIssue } = await ensureAssignmentUpToDate({ assignment });
  const plain = typeof refreshed.toObject === 'function' ? refreshed.toObject() : refreshed;

  return {
    success: true,
    data: { assignment: pendingIssue ? { ...plain, pendingIssue } : plain },
  };
}

//Update an assignment before distribution.
async function updateAssignment({ instructorId, assignmentId, updateData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');

  const assignment = await loadOwnedAssignment(safeAssignmentId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_PEER_ASSIGNMENT_UPDATE_ATTEMPT',
  });
  assertAssignmentEditable(assignment);

  const safeUpdate = {};
  for (const field of UPDATABLE_FIELDS) {
    if (updateData[field] !== undefined) safeUpdate[field] = updateData[field];
  }

  const nextSubmissionDeadline =
    'submissionDeadline' in safeUpdate
      ? safeUpdate.submissionDeadline
      : assignment.submissionDeadline;
  const nextReviewDeadline =
    'reviewDeadline' in safeUpdate ? safeUpdate.reviewDeadline : assignment.reviewDeadline;

  if (nextSubmissionDeadline && new Date(nextSubmissionDeadline) <= new Date()) {
    throw new AppError(
      400,
      'INVALID_SUBMISSION_DEADLINE',
      'Submission deadline must be in the future.'
    );
  }
  if (nextReviewDeadline && !nextSubmissionDeadline) {
    throw new AppError(
      400,
      'INVALID_REVIEW_DEADLINE',
      'Cannot set a review deadline without a submission deadline.'
    );
  }
  if (
    nextReviewDeadline &&
    nextSubmissionDeadline &&
    new Date(nextReviewDeadline) <= new Date(nextSubmissionDeadline)
  ) {
    throw new AppError(
      400,
      'INVALID_REVIEW_DEADLINE',
      'The review deadline must come after the submission deadline.'
    );
  }

  Object.assign(assignment, safeUpdate);
  await assignment.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'PEER_ASSIGNMENT_UPDATED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: { fields_updated: Object.keys(safeUpdate) },
    req,
  });

  // === إصلاح: كانت الدالة الوحيدة بين دوال assignment التي لا تستدعي
  // ensureAssignmentUpToDate قبل الإرجاع (على عكس create/get/list) — كانت تُرجع
  // حالة قديمة للمدرب مباشرة بعد التعديل بدل الحالة المحدَّثة فعلياً.
  const { assignment: refreshed, pendingIssue } = await ensureAssignmentUpToDate({ assignment });
  const plain = typeof refreshed.toObject === 'function' ? refreshed.toObject() : refreshed;

  return {
    success: true,
    data: { assignment: pendingIssue ? { ...plain, pendingIssue } : plain },
  };
}
//Delete an assignment before distribution.
async function deleteAssignment({ instructorId, assignmentId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');

  const assignment = await loadOwnedAssignment(safeAssignmentId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_PEER_ASSIGNMENT_DELETE_ATTEMPT',
  });
  assertAssignmentEditable(assignment);

  const submissionCount = await PeerSubmission.countDocuments({ assignmentId: safeAssignmentId });
  if (submissionCount > 0) {
    throw new AppError(
      409,
      'ASSIGNMENT_HAS_SUBMISSIONS',
      'Cannot delete an assignment that already has submissions. Close it instead.'
    );
  }

  await assignment.deleteOne();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'PEER_ASSIGNMENT_DELETED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: { courseId: assignment.courseId.toString(), title: assignment.title },
    req,
  });

  return { success: true, data: { deleted: true } };
}

//List assignments for the viewer
async function listAssignmentsForViewer({ userId, role, queryParams = {} }) {
  const safeUserId = toObjectId(userId, 'userId');
  const filter = {};

  if (queryParams.status && ['open', 'distributed', 'completed'].includes(queryParams.status)) {
    filter.status = queryParams.status;
  }

  if (role === 'Instructor') {
    filter.instructorId = safeUserId;
  } else {
    const activeEnrollments = await Enrollment.find({ student_id: safeUserId, status: 'active' })
      .select('course_id')
      .lean();
    const courseIds = activeEnrollments.map((e) => e.course_id);
    if (courseIds.length === 0) {
      return { success: true, data: { assignments: [] } };
    }
    filter.courseId = { $in: courseIds };
  }

  const rawAssignments = await PeerAssignment.find(filter).sort({ submissionDeadline: 1 }).lean();

  const assignments = [];
  for (const assignment of rawAssignments) {
    const { assignment: refreshed, pendingIssue } = await ensureAssignmentUpToDate({ assignment });
    const plain = typeof refreshed.toObject === 'function' ? refreshed.toObject() : refreshed;
    assignments.push(pendingIssue ? { ...plain, pendingIssue } : plain);
  }

  return { success: true, data: { assignments } };
}

//Get details of a single assignment.
async function getAssignmentDetails({ userId, role, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  }

  if (role === 'Instructor') {
    if (assignment.instructorId.toString() !== userId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this assignment.');
    }
  } else {
    const enrolled = await Enrollment.findOne({
      student_id: userId,
      course_id: assignment.courseId,
      status: 'active',
    }).lean();
    if (!enrolled) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You are not enrolled in the course for this assignment.'
      );
    }
  }

  const { assignment: refreshed, pendingIssue } = await ensureAssignmentUpToDate({ assignment });
  const plain = typeof refreshed.toObject === 'function' ? refreshed.toObject() : refreshed;

  return {
    success: true,
    data: { assignment: pendingIssue ? { ...plain, pendingIssue } : plain },
  };
}

module.exports = {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listAssignmentsForViewer,
  getAssignmentDetails,
  assertInstructorOwnsCourse,
  loadOwnedAssignment,
  assertAssignmentEditable,
  UPDATABLE_FIELDS,
};
