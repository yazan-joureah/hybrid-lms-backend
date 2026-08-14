// src/services/quiz/quizSession.service.js
const Quiz = require('../../models/quiz.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { checkQuizEligibility } = require('./eligibility.service');
const { generateShuffledOrder } = require('./randomizer.service');
const { sanitizeQuizForStudent } = require('./sanitize.service');
const { autoSubmitExpiredAttempt } = require('./autoSubmit.service');
const { gradeAttempt } = require('./grading.service');

//starts a new quiz attempt.
async function startQuizAttempt({ studentId, quizId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const { quiz, lifetimeAttemptsCount } = await checkQuizEligibility({
    studentId: safeStudentId,
    quizId: safeQuizId,
  });

  const shuffledOrder = generateShuffledOrder({ quiz });
  const expiresAt = new Date(Date.now() + quiz.duration_minutes * 60 * 1000);

  const attempt = new QuizAttempt({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
    attempt_number: lifetimeAttemptsCount + 1,
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

async function submitAnswer({ studentId, attemptId, questionId, selectedChoiceId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');
  const safeQuestionId = toObjectId(questionId, 'questionId');
  const safeChoiceId = toObjectId(selectedChoiceId, 'selectedChoiceId');

  const attempt = await QuizAttempt.findOne({ _id: safeAttemptId, student_id: safeStudentId });
  if (!attempt) {
    throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found.');
  }

  if (attempt.status === 'in_progress' && attempt.expires_at < new Date()) {
    await autoSubmitExpiredAttempt({ attempt, req });
    throw new AppError(409, 'ATTEMPT_TIMED_OUT', 'Time is up — this attempt was auto-submitted.');
  }
  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer active.');
  }

  const belongsToAttempt = attempt.shuffled_question_order.some((q) =>
    q.question_id.equals(safeQuestionId)
  );
  if (!belongsToAttempt) {
    throw new AppError(
      400,
      'QUESTION_NOT_IN_ATTEMPT',
      'This question does not belong to your attempt.'
    );
  }

  const existingIndex = attempt.answers.findIndex((a) => a.question_id.equals(safeQuestionId));
  const answerEntry = {
    question_id: safeQuestionId,
    selected_choice_id: safeChoiceId,
    answered_at: new Date(),
  };
  if (existingIndex >= 0) {
    attempt.answers[existingIndex] = answerEntry;
  } else {
    attempt.answers.push(answerEntry);
  }
  await attempt.save();

  return { success: true, data: { saved: true, answered_count: attempt.answers.length } };
}

//Student ends the attempt before time runs out
async function submitAttempt({ studentId, attemptId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');

  const attempt = await QuizAttempt.findOne({ _id: safeAttemptId, student_id: safeStudentId });
  if (!attempt) {
    throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found.');
  }

  // if the student's "Submit" click arrives AFTER expiry treat it as a timeout, not a manual submission
  if (attempt.status === 'in_progress' && attempt.expires_at < new Date()) {
    const result = await autoSubmitExpiredAttempt({ attempt, req });
    return result;
  }

  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer active.');
  }

  attempt.status = 'submitted';
  attempt.submitted_at = new Date();
  attempt.submitted_by = 'student';
  await attempt.save();

  const result = await gradeAttempt({ attempt, req });
  return result;
}

// GET /attempts/:attemptId (resume path)
async function getAttemptForResume({ studentId, attemptId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');

  const attempt = await QuizAttempt.findOne({ _id: safeAttemptId, student_id: safeStudentId });
  if (!attempt) {
    throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found.');
  }

  if (attempt.status === 'in_progress' && attempt.expires_at < new Date()) {
    await autoSubmitExpiredAttempt({ attempt, req: null });
    throw new AppError(409, 'ATTEMPT_TIMED_OUT', 'Time is up — this attempt was auto-submitted.');
  }
  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer active.');
  }

  const quiz = await Quiz.findById(attempt.quiz_id);

  return {
    success: true,
    data: {
      attempt_id: attempt._id,
      expires_at: attempt.expires_at,
      quiz: sanitizeQuizForStudent({ quiz, shuffledOrder: attempt.shuffled_question_order }),
      previous_answers: attempt.answers.map((a) => ({
        question_id: a.question_id,
        selected_choice_id: a.selected_choice_id,
      })),
    },
  };
}

module.exports = { startQuizAttempt, submitAnswer, submitAttempt, getAttemptForResume };
