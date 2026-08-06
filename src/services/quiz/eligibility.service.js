// src/services/quiz/eligibility.service.js
const Quiz = require('../../models/quiz.model');
const Enrollment = require('../../models/Enrollment');
const QuizAttempt = require('../../models/quizAttempt.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * Confirms the student has an active enrollment in the quiz's course, the
 * current time falls within the quiz's availability window, and the
 * student has not exhausted the allowed attempts. Returns the fetched
 * quiz + current attempt count for the caller to reuse (avoids a
 * duplicate re-fetch in quizSession.service.js).
 */
async function checkQuizEligibility({ studentId, quizId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await Quiz.findById(safeQuizId);
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'This quiz does not exist.');
  }

  if (quiz.status !== 'published') {
    throw new AppError(404, 'QUIZ_NOT_FOUND', ' This quiz does now exsist');
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
  if (now < quiz.start_time || now > quiz.end_time) {
    throw new AppError(400, 'QUIZ_WINDOW_CLOSED', 'This quiz is not currently available.');
  }

  const attemptsCount = await QuizAttempt.countDocuments({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
  });
  if (attemptsCount >= quiz.max_attempts) {
    throw new AppError(403, 'ATTEMPTS_EXHAUSTED', 'You have used all available attempts.');
  }

  return { quiz, attemptsCount };
}

module.exports = { checkQuizEligibility };
