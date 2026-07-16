// src/services/course.service.js
const Course = require('../../models/Course');
const User = require('../../models/User');
const auditService = require('./auditService');
const { ApiError } = require('../../middleware/errorHandler');

/**
 * Creates a new course in 'draft' status.
 * Mitigates MUC-COURSE-04 by verifying KYC and MFA server-side.
 * @param {object} params
 * @param {string} params.instructorId - ID of the creating user
 * @param {object} params.courseData - Fields like title, description, category, etc.
 * @param {import('express').Request} params.req - Used for audit IP/User-Agent capture
 */
async function createCourse({ instructorId, courseData, req }) {
  // 1. Fetch instructor details directly from the DB (never trust JWT data blindly)
  const instructor = await User.findById(instructorId);
  if (!instructor) {
    throw new ApiError(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor account does not exist.');
  }

  // 2. MUC-COURSE-04: Strict server-side KYC enforcement
  if (instructor.kyc_status !== 'verified') {
    throw new ApiError(
      403,
      'KYC_NOT_VERIFIED',
      'You must complete your identity verification (KYC) before creating courses.'
    );
  }

  // 3. MUC-COURSE-04: Strict server-side MFA enforcement
  if (!instructor.mfa_enabled) {
    throw new ApiError(
      403,
      'MFA_REQUIRED',
      'Multi-factor authentication (MFA) must be enabled to create courses.'
    );
  }

  // 4. Force default secure state: status must start as 'draft'
  const newCourse = new Course({
    ...courseData,
    owner_instructor_id: instructorId,
    status: 'draft',
    content_complete: false,
    published_at: null,
  });

  // 5. Save course (triggers your applyReferentialIntegrity checks automatically)
  await newCourse.save();

  // 6. Record security audit trail (OWASP A09 / FR-30)
  await auditService.record({
    actorId: instructorId,
    actorRole: instructor.role,
    action: 'COURSE_CREATED',
    resourceType: 'Course',
    resourceId: newCourse._id.toString(),
    metadata: {
      title: newCourse.title,
      course_type: newCourse.course_type,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return newCourse;
}

/**
 * Fetches all courses owned by a specific instructor.
 * @param {string} instructorId - ID of the authenticated instructor
 * @param {object} queryParams - Optional pagination/sorting params
 */
async function getInstructorCourses(instructorId, queryParams = {}) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // Hardcode ownership to prevent fetching other instructors' courses
  const query = { owner_instructor_id: instructorId };

  const [courses, totalRecords] = await Promise.all([
    Course.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Course.countDocuments(query),
  ]);

  return {
    courses,
    meta: {
      total_records: totalRecords,
      current_page: page,
      total_pages: Math.ceil(totalRecords / limit),
    },
  };
}

/**
 * Updates an existing course.
 * Mitigates MUC-COURSE-05 (Course IDOR) via server-side ownership check.
 * Mitigates MUC-COURSE-06 (Review Bypass) via state reset on sensitive changes.
 */
async function updateCourse({ courseId, instructorId, updateData, req }) {
  const course = await Course.findById(courseId);

  if (!course) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  // 1. MUC-COURSE-05: Server-side ownership verification (IDOR prevention)
  if (course.owner_instructor_id.toString() !== instructorId) {
    // Log this as a security event, as it implies malicious probing
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_COURSE_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: courseId,
      metadata: { target_owner: course.owner_instructor_id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  // 2. Determine if sensitive fields are being modified
  const sensitiveFields = ['title', 'description', 'price', 'course_type', 'is_synchronous'];
  let sensitiveChangeDetected = false;
  let changesSnapshot = { before: {}, after: {} };

  sensitiveFields.forEach((field) => {
    if (updateData[field] !== undefined && updateData[field] !== course[field]) {
      sensitiveChangeDetected = true;
      changesSnapshot.before[field] = course[field];
      changesSnapshot.after[field] = updateData[field];
    }
  });

  // 3. MUC-COURSE-06: State Machine Control (Review Bypass prevention)
  if (course.status === 'published' && sensitiveChangeDetected) {
    course.status = 'pending_review';
    // Optionally create a CourseReviewRequest document here based on your ERD
  }

  // 4. Apply updates
  Object.assign(course, updateData);
  await course.save();

  // 5. Audit Log the update
  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UPDATED',
    resourceType: 'Course',
    resourceId: courseId,
    metadata: {
      status_changed_to: course.status,
      sensitive_change: sensitiveChangeDetected,
      changes: changesSnapshot,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return course;
}

module.exports = {
  createCourse,
  getInstructorCourses,
  updateCourse,
};
