// src/services/quiz/grading.service.js
const Quiz = require('../../models/quiz.model');
const auditService = require('../auditService');

//Grade Quiz & Log Results.
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

  return { success: true, data: { attempt } };
}

module.exports = { gradeAttempt };
