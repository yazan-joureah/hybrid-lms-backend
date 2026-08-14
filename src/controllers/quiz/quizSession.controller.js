// src/controllers/quiz/quizSession.controller.js
const {
  startQuizAttempt,
  submitAnswer,
  submitAttempt,
  getAttemptForResume,
} = require('../../services/quizService');

/** UC-QUIZ-02: student starts a new quiz attempt. */
async function start(req, res, next) {
  try {
    const studentId = req.user.id;
    const { quizId } = req.params;
    const result = await startQuizAttempt({ studentId, quizId, req });
    return res.status(201).json({
      success: true,
      message: 'Quiz attempt started successfully.',
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

// Auto-Save, called every 30s by the client.
async function saveAnswer(req, res, next) {
  try {
    const studentId = req.user.id;
    const { attemptId } = req.params;
    const { question_id, selected_choice_id } = req.body;

    const result = await submitAnswer({
      studentId,
      attemptId,
      questionId: question_id,
      selectedChoiceId: selected_choice_id,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

// manual trigger
async function submit(req, res, next) {
  try {
    const studentId = req.user.id;
    const { attemptId } = req.params;

    const result = await submitAttempt({ studentId, attemptId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function resume(req, res, next) {
  try {
    const studentId = req.user.id;
    const { attemptId } = req.params;
    const result = await getAttemptForResume({ studentId, attemptId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { start, saveAnswer, submit, resume };
