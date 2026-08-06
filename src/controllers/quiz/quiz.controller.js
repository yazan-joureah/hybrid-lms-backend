// src/controllers/quiz/quiz.controller.js
const { createQuiz, updateQuiz, publishQuiz } = require('../../services/quizService');

/** creates a quiz/exam draft. */
async function create(req, res, next) {
  try {
    const instructorId = req.user.id;
    const {
      course_id,
      unit_id,
      quiz_type,
      title,
      description,
      start_time,
      end_time,
      duration_minutes,
      passing_score_percent,
      max_attempts,
      allow_back_navigation,
      questions,
    } = req.body;

    const quizData = {
      course_id,
      unit_id,
      quiz_type,
      title,
      description,
      start_time,
      end_time,
      duration_minutes,
      passing_score_percent,
      max_attempts,
      allow_back_navigation,
      questions,
    };

    const result = await createQuiz({ instructorId, quizData, req });

    return res.status(201).json({
      success: true,
      message: 'Quiz draft created successfully.',
      data: { quiz: result.data.quiz },
    });
  } catch (err) {
    return next(err);
  }
}

/** updates a quiz's fields; blocked once locked (first attempt started). */
async function update(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { quizId } = req.params;
    const {
      title,
      description,
      start_time,
      end_time,
      duration_minutes,
      passing_score_percent,
      max_attempts,
      allow_back_navigation,
      questions,
    } = req.body;

    const updateData = Object.fromEntries(
      Object.entries({
        title,
        description,
        start_time,
        end_time,
        duration_minutes,
        passing_score_percent,
        max_attempts,
        allow_back_navigation,
        questions,
      }).filter(([_, v]) => v !== undefined)
    );

    const result = await updateQuiz({ quizId, instructorId, updateData, req });

    return res.status(200).json({
      success: true,
      message: 'Quiz updated successfully.',
      data: { quiz: result.data.quiz },
    });
  } catch (err) {
    return next(err);
  }
}

/** publishes a draft quiz, making it available to enrolled students. */
async function publish(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { quizId } = req.params;

    const result = await publishQuiz({ quizId, instructorId, req });

    return res.status(200).json({
      success: true,
      message: 'Quiz published successfully.',
      data: { quiz: result.data.quiz },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, update, publish };
