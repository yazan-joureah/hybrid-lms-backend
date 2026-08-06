const Quiz = require('../../models/quiz.model');
const Course = require('../../models/Course');
const User = require('../../models/User');
const CourseUnit = require('../../models/CourseUnit');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

// Create a new quiz/exam in 'draft' status
async function createQuiz({ instructorId, quizData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(quizData.course_id, 'course_id');

  const instructor = await User.findById(safeInstructorId);
  if (!instructor) {
    throw new AppError(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor account does not exsist');
  }

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
  }

  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_QUIZ_CREATE_ATTEMPT',
      resourceType: 'Course',
      resourceId: safeCourseId,
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(
      403,
      'FORBIDDEN',
      'You do not have permission to add a quiz to this course.'
    );
  }

  let safeUnitId = null;
  if (quizData.quiz_type === 'quiz') {
    safeUnitId = toObjectId(quizData.unit_id, 'unit_id');
    const unit = await CourseUnit.findById(safeUnitId);
    if (!unit || !unit.course_id.equals(safeCourseId)) {
      throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course');
    }
  }

  const newQuiz = new Quiz({
    ...quizData,
    course_id: safeCourseId,
    unit_id: safeUnitId,
    instructor_id: safeInstructorId,
    status: 'draft',
    locked: false,
  });
  await newQuiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_CREATED',
    resourceType: 'Quiz',
    resourceId: newQuiz._id.toString(),
    metadata: { title: newQuiz.title, quiz_type: newQuiz.quiz_type, course_id: safeCourseId },
    req,
  });

  return { success: true, data: { quiz: newQuiz } };
}

// Updates a draft OR published quiz - edatable as long as no first attempt
async function updateQuiz({ quizId, instructorId, updateData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await Quiz.findById(safeQuizId);
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
  }

  if (quiz.instructor_id.toString() !== safeInstructorId.toString()) {
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'UNAUTRIZED_QUIZ_UPDATE_ATTEMPT',
      resourceType: 'Quiz',
      resourceId: safeQuizId,
      metadata: { target_owner: quiz.instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this quiz');
  }

  //check if quiz editable
  if (quiz.locked) {
    throw new AppError(
      409,
      'QUIZ_LOCKED',
      'Cannot modify this quiz - a student has already started an attempt'
    );
  }

  Object.assign(quiz, updateData);
  await quiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_UPDATED',
    resourceType: 'Quiz',
    resourceId: safeQuizId,
    metadata: { fields_updated: Object.keys(updateData) },
    req,
  });

  return { success: true, data: { quiz } };
}

// Publish quiz, make it visible and available to the enrolled students.
async function publishQuiz({ quizId, instructorId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeQuizId = toObjectId(quizId, 'quizId');

  const quiz = await Quiz.findById(safeQuizId);
  if (!quiz) {
    throw new AppError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
  }

  if (quiz.instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this quiz');
  }

  if (quiz.status === 'published') {
    throw new AppError(400, 'ALREADY_PUBLISHED', 'Quiz is already published');
  }

  quiz.status = 'published';
  await quiz.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'QUIZ_PUBLISHED',
    resourceType: 'Quiz',
    resourceId: safeQuizId,
    metadata: { course_id: quiz.course_id.toString() },
    req,
  });

  return { success: true, data: { quiz } };
}

module.exports = { createQuiz, updateQuiz, publishQuiz };
