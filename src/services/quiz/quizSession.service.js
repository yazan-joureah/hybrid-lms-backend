// src/services/quiz/quizSession.service.js
const QuizAttempt = require('../../models/quizAttempt.model');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { checkQuizEligibility } = require('./eligibility.service');
const { generateShuffledOrder } = require('./randomizer.service');
const { sanitizeQuizForStudent } = require('./sanitize.service');

//starts a new quiz attempt.
async function startQuizAttempt({ studentId, quizId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const { quiz, attemptsCount } = await checkQuizEligibility({
    studentId: safeStudentId,
    quizId: safeQuizId,
  });

  const shuffledOrder = generateShuffledOrder({ quiz });
  const expiresAt = new Date(Date.now() + quiz.duration_minutes * 60 * 1000);

  const attempt = new QuizAttempt({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
    attempt_number: attemptsCount + 1,
    shuffled_question_order: shuffledOrder,
    status: 'in_progress',
    started_at: new Date(),
    expires_at: expiresAt,
  });

  try {
    await attempt.save();
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(
        409,
        'ATTEMPT_IN_PROGRESS',
        'You already have an in-progress attempt for this quiz.'
      );
    }
    throw err;
  }

  if (!quiz.locked) {
    quiz.locked = true;
    await quiz.save();
  }

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'QUIZ_ATTEMPT_STARTED',
    resourceType: 'QuizAttempt',
    resourceId: attempt._id.toString(),
    metadata: { quiz_id: safeQuizId.toString(), attempt_number: attempt.attempt_number },
    req,
  });

  return {
    success: true,
    data: {
      attempt_id: attempt._id,
      expires_at: attempt.expires_at,
      quiz: sanitizeQuizForStudent({ quiz, shuffledOrder }),
    },
  };
}

module.exports = { startQuizAttempt };
