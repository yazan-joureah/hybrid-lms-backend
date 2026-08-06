// src/controllers/quiz/quizSession.controller.js
const { startQuizAttempt } = require('../../services/quizService');

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

module.exports = { start };
