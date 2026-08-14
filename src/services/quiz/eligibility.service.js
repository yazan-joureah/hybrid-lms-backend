// src/services/quiz/eligibility.service.js
const Quiz = require('../../models/quiz.model');
const Enrollment = require('../../models/Enrollment');
const QuizAttempt = require('../../models/quizAttempt.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

const DAY_MS = 24 * 60 * 60 * 1000;

async function checkQuizEligibility({ studentId, quizId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await Quiz.findById(safeQuizId);
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'This quiz does not exist.');
  }
  if (quiz.status !== 'published') {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'This quiz does not exist.');
  }

  const enrollment = await Enrollment.findOne({
    course_id: quiz.course_id,
    student_id: safeStudentId,
    status: 'active',
  }).lean();
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not eligible to take this quiz.');
  }

  const now = new Date();

  if (quiz.start_time && now < quiz.start_time) {
    throw new AppError(400, 'QUIZ_WINDOW_CLOSED', 'This quiz is not currently available.');
  }
  if (quiz.end_time && now > quiz.end_time) {
    throw new AppError(400, 'QUIZ_WINDOW_CLOSED', 'This quiz is not currently available.');
  }

  // max_attempts limits attempts PER DAY.
  const dailyAttemptsCount = await QuizAttempt.countDocuments({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
    started_at: { $gte: new Date(Date.now() - DAY_MS) },
  });
  if (dailyAttemptsCount >= quiz.max_attempts) {
    throw new AppError(403, 'ATTEMPTS_EXHAUSTED', 'You have used all attempts allowed for today.');
  }

  const lifetimeAttemptsCount = await QuizAttempt.countDocuments({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
  });

  return { quiz, lifetimeAttemptsCount };
}

module.exports = { checkQuizEligibility };
