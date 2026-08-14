// src/services/quiz/autoSubmit.service.js
const auditService = require('../auditService');
const { gradeAttempt } = require('./grading.service');

//Auto-Submit On Timeout
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

  //grading happens immediately after submission,

  await gradeAttempt({ attempt, req });

  return { success: true, data: { attempt } };
}

module.exports = { autoSubmitExpiredAttempt };
