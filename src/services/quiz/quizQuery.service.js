// src/services/quiz/quizQuery.service.js
const Quiz = require('../../models/quiz.model');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * Instructor-facing: full quiz detail
 */
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

/**
 * Instructor-facing: paginated list of the instructor's own quizzes.
 */
async function listInstructorQuizzes({ instructorId, queryParams = {} }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
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

/**
 * Deletes a quiz.
 */
async function deleteQuiz({ quizId, instructorId, req }) {
  const safeQuizId = toObjectId(quizId, 'quizId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const quiz = await Quiz.findById(safeQuizId);
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'Quiz not found.');
  }
  if (quiz.instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to delete this quiz.');
  }

  //check if quiz editable
  if (quiz.locked) {
    throw new AppError(
      409,
      'QUIZ_LOCKED',
      'Cannot modify this quiz - a student has already started an attempt'
    );
  }

  await quiz.deleteOne();

  const auditService = require('../auditService');
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

/**
 * Student-facing: list of published quizzes for a course the student is
 * enrolled in. Deliberately excludes the `questions` array entirely (not
 * just is_correct) — a list view has no reason to carry question content
 * at all; the student only sees full question data via startQuizAttempt
 * (UC-QUIZ-02), which builds the shuffled, sanitized structure.
 */
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

module.exports = {
  getQuizForInstructor,
  listInstructorQuizzes,
  deleteQuiz,
  listAvailableQuizzesForStudent,
};
