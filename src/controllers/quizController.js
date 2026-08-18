// src/controllers/quizController.js
const {
  createQuiz,
  updateQuiz,
  publishQuiz,
  deleteQuiz,
  getQuizForInstructor,
  listInstructorQuizzes,
  listAvailableQuizzesForStudent,
  listQuizzesForCourseReview,
} = require('../services/quiz/quiz.service');

const {
  startQuizAttempt,
  submitAnswer,
  submitAttempt,
  getAttemptForResume,
  getCurrentAttempt,
} = require('../services/quiz/quizSession.service');

// ---------------------------------------------------------------------------
// Instructor: CRUD
// ---------------------------------------------------------------------------

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

    const result = await createQuiz({
      instructorId,
      quizData: {
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
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Quiz draft created successfully.',
      data: { quiz: result.data.quiz },
    });
  } catch (err) {
    return next(err);
  }
}

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
      }).filter(([, v]) => v !== undefined)
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

async function remove(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { quizId } = req.params;
    const result = await deleteQuiz({ quizId, instructorId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { quizId } = req.params;
    const result = await getQuizForInstructor({ quizId, instructorId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await listInstructorQuizzes({ instructorId, queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function listForAdminReview(req, res, next) {
  try {
    const { courseId } = req.params;
    const result = await listQuizzesForCourseReview({ courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Student Browse
// ---------------------------------------------------------------------------

async function listAvailable(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await listAvailableQuizzesForStudent({ studentId, courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Student Attempt
// ---------------------------------------------------------------------------

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

async function getCurrent(req, res, next) {
  try {
    const studentId = req.user.id;
    const { quizId } = req.params;
    const result = await getCurrentAttempt({ studentId, quizId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  create,
  update,
  publish,
  remove,
  getOne,
  list,
  listForAdminReview,
  listAvailable,
  start,
  saveAnswer,
  submit,
  resume,
  getCurrent,
};
