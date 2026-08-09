// src/controllers/quiz/quizQuery.controller.js
const {
  getQuizForInstructor,
  listInstructorQuizzes,
  deleteQuiz,
  listAvailableQuizzesForStudent,
} = require('../../services/quizService');

/** Instructor: full quiz detail */
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

/** Instructor: paginated list of own quizzes */
async function list(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await listInstructorQuizzes({ instructorId, queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Instructor: deletes a quiz */
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

/** Student: list of published, available quizzes for an enrolled course. */
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

module.exports = { getOne, list, remove, listAvailable };
