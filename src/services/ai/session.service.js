// src/services/ai/session.service.js
// UC-AI-04 — Start Instructor AI Session
// UC-AI-01 — Start Student AI Session

const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Enrollment = require('../../models/Enrollment');
const Attendance = require('../../models/attendance.model');
const AIConversation = require('../../models/AIConversation');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { buildInstructorSystemPrompt, buildStudentSystemPrompt } = require('./systemPrompt.service');

/** يتحقق أن المحاضر يملك الكورس فعلياً — نسخة محلية لهذه الوحدة، نفس نمط
 *  الفحص المكرَّر عمداً في كل وحدة (COURSE/LIVE/PEER) بدل اعتمادية متبادلة. */
async function assertInstructorOwnsCourse({ instructorId, courseId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'الكورس غير موجود.');
  }
  if (course.owner_instructor_id.toString() !== instructorId.toString()) {
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_AI_SESSION_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: courseId.toString(),
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية إدارة هذا الكورس.');
  }
  return course;
}

/** إحصاءات مُجمَّعة ومجهولة الهوية للمحاضر — بلا أي اسم أو معرِّف طالب. */
async function getAggregatedPerformance(courseId) {
  const [activeEnrollmentCount, attendanceAgg] = await Promise.all([
    Enrollment.countDocuments({ course_id: courseId, status: 'active' }),
    Attendance.aggregate([
      { $match: { courseId } },
      { $group: { _id: null, avgSeconds: { $avg: '$durationSeconds' } } },
    ]),
  ]);

  const avgAttendanceMinutes = attendanceAgg[0]?.avgSeconds
    ? Math.round(attendanceAgg[0].avgSeconds / 60)
    : null;

  return { activeEnrollmentCount, avgAttendanceMinutes };
}

/**
 * UC-AI-04 — يفتح/يُحدِّث جلسة مساعد AI للمحاضر لكورس معيَّن.
 * include SF-AI-01 (حقن System Prompt) — إلزامي، لا استثناء.
 */
async function startInstructorSession({ instructorId, courseId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const course = await assertInstructorOwnsCourse({
    instructorId: safeInstructorId,
    courseId: safeCourseId,
    req,
  });

  const units = await CourseUnit.find({ course_id: safeCourseId }).sort({ order: 1 }).select('title').lean();
  const aggregatedPerformance = await getAggregatedPerformance(safeCourseId);

  // SF-AI-01 — include إلزامي، يُبنى من بيانات الخادم حصراً
  const { systemPrompt } = buildInstructorSystemPrompt({
    courseTitle: course.title,
    unitTitles: units.map((u) => u.title),
    aggregatedPerformance,
  });

  const conversation = await AIConversation.findOneAndUpdate(
    { userId: safeInstructorId, courseId: safeCourseId },
    {
      $set: { role: 'Instructor', systemPromptSnapshot: systemPrompt, status: 'active' },
      $setOnInsert: { messages: [] },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'AI_INSTRUCTOR_SESSION_STARTED',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { courseId: safeCourseId.toString() },
    req,
  });

  return {
    success: true,
    data: {
      sessionId: conversation._id,
      options: ['content_suggestions', 'performance_summary'],
    },
  };
}

/**
 * UC-AI-01 — يفتح/يُحدِّث جلسة مساعد AI للطالب لكورس معيَّن.
 * include SF-AI-02 (حقن System Prompt) — إلزامي، لا استثناء.
 */
async function startStudentSession({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const enrollment = await Enrollment.findOne({
    student_id: safeStudentId,
    course_id: safeCourseId,
    status: 'active',
  }).lean();

  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'غير مسجل في كورس فعّال — الاشتراك مطلوب لبدء المساعد.');
  }

  const course = await Course.findById(safeCourseId).select('title').lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'الكورس غير موجود.');
  }

  const units = await CourseUnit.find({ course_id: safeCourseId }).sort({ order: 1 }).select('title').lean();

  const completedUnitIds = await CourseProgressEvent.distinct('unit_id', {
    course_id: safeCourseId,
    student_id: safeStudentId,
  });
  const completedIdSet = new Set(completedUnitIds.map((id) => id.toString()));
  const completedUnitTitles = units.filter((u) => completedIdSet.has(u._id.toString())).map((u) => u.title);

  // SF-AI-02 — include إلزامي، يُبنى من بيانات الخادم حصراً
  const { systemPrompt } = buildStudentSystemPrompt({
    courseTitle: course.title,
    unitTitles: units.map((u) => u.title),
    completedUnitTitles,
  });

  const conversation = await AIConversation.findOneAndUpdate(
    { userId: safeStudentId, courseId: safeCourseId },
    {
      $set: { role: 'Student', systemPromptSnapshot: systemPrompt, status: 'active' },
      $setOnInsert: { messages: [] },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'AI_STUDENT_SESSION_STARTED',
    resourceType: 'AIConversation',
    resourceId: conversation._id.toString(),
    metadata: { courseId: safeCourseId.toString() },
    req,
  });

  return { success: true, data: { sessionId: conversation._id } };
}

module.exports = { startInstructorSession, startStudentSession, assertInstructorOwnsCourse, getAggregatedPerformance };
