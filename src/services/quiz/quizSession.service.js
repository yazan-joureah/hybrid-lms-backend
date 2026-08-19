// src/services/quiz/quizSession.service.js
const Quiz = require('../../models/quiz.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const Enrollment = require('../../models/Enrollment');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { generateShuffledOrder, sanitizeQuizForStudent } = require('./quizPresentation.service');
const {
  checkCertificateEligibilityAfterGrading,
} = require('../cert/certificateEligibility.service');

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

async function checkQuizEligibility({ studentId, quizId }) {
  const quiz = await Quiz.findById(quizId);

  if (!quiz || quiz.status !== 'published') {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'This quiz does not exist.');
  }

  const enrollment = await Enrollment.findOne({
    course_id: quiz.course_id,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
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

  // A quiz with no max_attempts configured (or set to 0) is intentionally
  // unlimited — made explicit here instead of relying on
  // `count >= undefined` being implicitly false, so "unlimited" is a
  // documented decision rather than an accident of comparison semantics.
  const hasDailyCap = typeof quiz.max_attempts === 'number' && quiz.max_attempts > 0;
  if (hasDailyCap) {
    const dailyAttemptsCount = await QuizAttempt.countDocuments({
      quiz_id: quiz._id,
      student_id: studentId,
      started_at: { $gte: new Date(Date.now() - DAY_MS) },
    });
    if (dailyAttemptsCount >= quiz.max_attempts) {
      throw new AppError(
        403,
        'ATTEMPTS_EXHAUSTED',
        'You have used all attempts allowed for today.'
      );
    }
  }

  const lifetimeAttemptsCount = await QuizAttempt.countDocuments({
    quiz_id: quiz._id,
    student_id: studentId,
  });

  return { quiz, lifetimeAttemptsCount };
}
// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

async function gradeAttempt({ attempt, req }) {
  const quiz = await Quiz.findById(attempt.quiz_id);

  const answerKey = new Map();
  quiz.questions.forEach((q) => {
    const correctChoice = q.choices.find((c) => c.is_correct);
    answerKey.set(q._id.toString(), correctChoice._id.toString());
  });

  let correctCount = 0;
  attempt.answers.forEach((a) => {
    if (answerKey.get(a.question_id.toString()) === a.selected_choice_id.toString()) {
      correctCount += 1;
    }
  });

  const totalQuestions = quiz.questions.length;
  const scorePercent = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

  attempt.score_percent = scorePercent;
  attempt.passed = scorePercent >= quiz.passing_score_percent;
  attempt.graded_at = new Date();
  attempt.status = 'graded';
  await attempt.save();

  await auditService.record({
    actorId: attempt.student_id,
    actorRole: 'System',
    action: 'QUIZ_ATTEMPT_GRADED',
    resourceType: 'QuizAttempt',
    resourceId: attempt._id.toString(),
    metadata: {
      quiz_id: quiz._id.toString(),
      score_percent: scorePercent,
      passed: attempt.passed,
      correct_count: correctCount,
      total_questions: totalQuestions,
    },
    req,
  });

  // Automatically triggers check certificate eligibility.
  await checkCertificateEligibilityAfterGrading({ attempt, req });

  return {
    success: true,
    data: {
      attempt,
      score: correctCount,
      total_possible: totalQuestions,
      percentage: Math.round(scorePercent * 10) / 10,
      passed: attempt.passed,
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-submit
// ---------------------------------------------------------------------------

async function autoSubmitExpiredAttempt({ attempt, req }) {
  attempt.status = 'submitted';
  attempt.submitted_at = new Date();
  attempt.submitted_by = 'system_timeout';
  await attempt.save();

  await auditService.record({
    actorId: attempt.student_id,
    actorRole: 'System',
    action: 'QUIZ_ATTEMPT_AUTO_SUBMITTED',
    resourceType: 'QuizAttempt',
    resourceId: attempt._id.toString(),
    metadata: { quiz_id: attempt.quiz_id.toString(), answered_count: attempt.answers.length },
    req,
  });

  return gradeAttempt({ attempt, req });
}

// ---------------------------------------------------------------------------
// Attempt lifecycle
// ---------------------------------------------------------------------------

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

async function loadActiveAttempt(attemptId, studentId, req) {
  const attempt = await QuizAttempt.findOne({ _id: attemptId, student_id: studentId });
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
  return attempt;
}

async function submitAnswer({ studentId, attemptId, questionId, selectedChoiceId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');
  const safeQuestionId = toObjectId(questionId, 'questionId');
  const safeChoiceId = toObjectId(selectedChoiceId, 'selectedChoiceId');

  const attempt = await loadActiveAttempt(safeAttemptId, safeStudentId, req);

  const questionEntry = attempt.shuffled_question_order.find((q) =>
    q.question_id.equals(safeQuestionId)
  );
  if (!questionEntry) {
    throw new AppError(
      400,
      'QUESTION_NOT_IN_ATTEMPT',
      'This question does not belong to your attempt.'
    );
  }

  const choiceBelongsToQuestion = questionEntry.shuffled_choice_ids.some((id) =>
    id.equals(safeChoiceId)
  );
  if (!choiceBelongsToQuestion) {
    throw new AppError(
      400,
      'CHOICE_NOT_IN_QUESTION',
      'This choice does not belong to the given question.'
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

async function submitAttempt({ studentId, attemptId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');

  const attempt = await QuizAttempt.findOne({ _id: safeAttemptId, student_id: safeStudentId });
  if (!attempt) {
    throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found.');
  }

  if (attempt.status === 'in_progress' && attempt.expires_at < new Date()) {
    return autoSubmitExpiredAttempt({ attempt, req });
  }
  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer active.');
  }

  attempt.status = 'submitted';
  attempt.submitted_at = new Date();
  attempt.submitted_by = 'student';
  await attempt.save();

  return gradeAttempt({ attempt, req });
}

async function getAttemptForResume({ studentId, attemptId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAttemptId = toObjectId(attemptId, 'attemptId');

  const attempt = await loadActiveAttempt(safeAttemptId, safeStudentId, null);
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

async function getCurrentAttempt({ studentId, quizId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const attempt = await QuizAttempt.findOne({
    quiz_id: safeQuizId,
    student_id: safeStudentId,
    status: 'in_progress',
  });
  if (!attempt) {
    return { success: true, data: null };
  }

  if (attempt.expires_at < new Date()) {
    await autoSubmitExpiredAttempt({ attempt, req });
    return { success: true, data: null };
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

module.exports = {
  checkQuizEligibility,
  gradeAttempt,
  autoSubmitExpiredAttempt,
  startQuizAttempt,
  submitAnswer,
  submitAttempt,
  getAttemptForResume,
  getCurrentAttempt,
};
