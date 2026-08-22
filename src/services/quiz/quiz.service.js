// src/services/quiz/quiz.service.js
const Quiz = require('../../models/quiz.model');
const Course = require('../../models/Course');
const User = require('../../models/User');
const CourseUnit = require('../../models/CourseUnit');
const Enrollment = require('../../models/Enrollment');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedResource } = require('../../utils/ownedResource.util');

const UPDATABLE_FIELDS = [
  'title',
  'description',
  'start_time',
  'end_time',
  'duration_minutes',
  'passing_score_percent',
  'max_attempts',
  'allow_back_navigation',
  'questions',
];

async function loadOwnedQuiz(quizId, instructorId, { req, unauthorizedAction } = {}) {
  return loadOwnedResource({
    model: Quiz,
    resourceId: quizId,
    actorId: instructorId,
    ownerField: 'instructor_id',
    resourceType: 'Quiz',
    notFoundCode: 'QUIZ_NOT_FOUND',
    notFoundMessage: 'Quiz not found.',
    forbiddenMessage: 'You do not have permission to modify this quiz.',
    unauthorizedAction,
    req,
  });
}

function assertEditable(quiz) {
  if (quiz.locked) {
    throw new AppError(
      409,
      'QUIZ_LOCKED',
      'Cannot modify this quiz - a student has already started an attempt.'
    );
  }
}

// ---------------------------------------------------------------------------
// Instructor: Create / Update / Publish / Delete
// ---------------------------------------------------------------------------

async function createQuiz({ instructorId, quizData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(quizData.course_id, 'course_id');

  const instructor = await User.findById(safeInstructorId);
  if (!instructor) {
    throw new AppError(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor account does not exist.');
  }

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_QUIZ_CREATE_ATTEMPT',
      resourceType: 'Course',
      resourceId: safeCourseId,
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(
      403,
      'FORBIDDEN',
      'You do not have permission to add a quiz to this course.'
    );
  }

  let safeUnitId = null;
  if (quizData.quiz_type === 'quiz') {
    safeUnitId = toObjectId(quizData.unit_id, 'unit_id');
    const unit = await CourseUnit.findById(safeUnitId);
    if (!unit || !unit.course_id.equals(safeCourseId)) {
      throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
    }
  }

  if (quizData.quiz_type === 'exam') {
    const existingExam = await Quiz.findOne({ course_id: safeCourseId, quiz_type: 'exam' }).lean();
    if (existingExam) {
      throw new AppError(
        409,
        'EXAM_ALREADY_EXISTS',
        'This course already has a final exam. Delete or edit the existing one instead of creating a new one.'
      );
    }
    // The only mandatory timing rule across the entire platform: a final exam
    // within a synchronous course must have a defined time window.
    if (course.is_synchronous && (!quizData.start_time || !quizData.end_time)) {
      throw new AppError(
        400,
        'EXAM_WINDOW_REQUIRED',
        'Final exams in synchronous courses must have both a start and end time.'
      );
    }
  }

  const newQuiz = new Quiz({
    ...quizData,
    course_id: safeCourseId,
    unit_id: safeUnitId,
    instructor_id: safeInstructorId,
    status: 'draft',
    locked: false,
  });
  await newQuiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_CREATED',
    resourceType: 'Quiz',
    resourceId: newQuiz._id.toString(),
    metadata: { title: newQuiz.title, quiz_type: newQuiz.quiz_type, course_id: safeCourseId },
    req,
  });

  return { success: true, data: { quiz: newQuiz } };
}

async function updateQuiz({ quizId, instructorId, updateData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await loadOwnedQuiz(safeQuizId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_QUIZ_UPDATE_ATTEMPT',
  });
  assertEditable(quiz);

  const safeUpdate = {};
  for (const field of UPDATABLE_FIELDS) {
    if (updateData[field] !== undefined) safeUpdate[field] = updateData[field];
  }

  if (quiz.quiz_type === 'exam') {
    const course = await Course.findById(quiz.course_id).select('is_synchronous').lean();
    const nextStart = 'start_time' in safeUpdate ? safeUpdate.start_time : quiz.start_time;
    const nextEnd = 'end_time' in safeUpdate ? safeUpdate.end_time : quiz.end_time;
    if (course?.is_synchronous && (!nextStart || !nextEnd)) {
      throw new AppError(
        400,
        'EXAM_WINDOW_REQUIRED',
        'Final exams in synchronous courses must have both a start and end time.'
      );
    }
  }

  Object.assign(quiz, safeUpdate);
  await quiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_UPDATED',
    resourceType: 'Quiz',
    resourceId: safeQuizId,
    metadata: { fields_updated: Object.keys(safeUpdate) },
    req,
  });

  return { success: true, data: { quiz } };
}

async function publishQuiz({ quizId, instructorId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await loadOwnedQuiz(safeQuizId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_QUIZ_PUBLISH_ATTEMPT',
  });

  if (quiz.status === 'published') {
    throw new AppError(400, 'ALREADY_PUBLISHED', 'Quiz is already published.');
  }

  quiz.status = 'published';
  await quiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_PUBLISHED',
    resourceType: 'Quiz',
    resourceId: safeQuizId,
    metadata: { course_id: quiz.course_id.toString() },
    req,
  });

  return { success: true, data: { quiz } };
}

async function deleteQuiz({ quizId, instructorId, req }) {
  const safeQuizId = toObjectId(quizId, 'quizId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const quiz = await loadOwnedQuiz(safeQuizId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_QUIZ_DELETE_ATTEMPT',
  });
  assertEditable(quiz);

  await quiz.deleteOne();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_DELETED',
    resourceType: 'Quiz',
    resourceId: safeQuizId.toString(),
    metadata: { course_id: quiz.course_id.toString(), title: quiz.title },
    req,
  });

  return { success: true, data: { deleted: true } };
}

// ---------------------------------------------------------------------------
// Queries: Instructor / Admin / Student
// ---------------------------------------------------------------------------

async function getQuizForInstructor({ quizId, instructorId }) {
  const safeQuizId = toObjectId(quizId, 'quizId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const quiz = await Quiz.findById(safeQuizId).lean();
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'Quiz not found.');
  }
  if (quiz.instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this quiz.');
  }

  return { success: true, data: { quiz } };
}

async function listInstructorQuizzes({ instructorId, queryParams = {} }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const page = Math.max(parseInt(queryParams.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(queryParams.limit, 10) || 10, 1), 100);
  const skip = (page - 1) * limit;

  const query = { instructor_id: safeInstructorId };
  if (queryParams.course_id) {
    query.course_id = toObjectId(queryParams.course_id, 'course_id');
  }
  if (queryParams.unit_id) {
    query.unit_id = toObjectId(queryParams.unit_id, 'unit_id');
  }

  const [quizzes, totalRecords] = await Promise.all([
    Quiz.find(query)
      .select('-questions.choices.is_correct')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Quiz.countDocuments(query),
  ]);

  return {
    success: true,
    data: {
      quizzes,
      meta: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
      },
    },
  };
}

async function listAvailableQuizzesForStudent({ studentId, courseId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const quizzes = await Quiz.find({ course_id: safeCourseId, status: 'published' })
    .select(
      'title description quiz_type unit_id start_time end_time duration_minutes passing_score_percent max_attempts'
    )
    .sort({ start_time: 1 })
    .lean();

  return { success: true, data: { quizzes } };
}

async function listQuizzesForCourseReview({ courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');

  const quizzes = await Quiz.find({ course_id: safeCourseId })
    .select('-questions.choices.is_correct')
    .sort({ quiz_type: 1, createdAt: 1 })
    .lean();

  return { success: true, data: { quizzes } };
}

module.exports = {
  createQuiz,
  updateQuiz,
  publishQuiz,
  deleteQuiz,
  getQuizForInstructor,
  listInstructorQuizzes,
  listAvailableQuizzesForStudent,
  listQuizzesForCourseReview,
};
