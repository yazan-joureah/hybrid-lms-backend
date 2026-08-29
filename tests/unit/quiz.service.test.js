// tests/unit/quiz.service.test.js
jest.mock('../../src/models/quiz.model');
jest.mock('../../src/models/Course');
jest.mock('../../src/models/User');
jest.mock('../../src/models/CourseUnit');
jest.mock('../../src/models/Enrollment');
// ===== ADD missing mock for QuizAttempt (prevents aggregate timeout) =====
jest.mock('../../src/models/quizAttempt.model');
// ======================================================================
jest.mock('../../src/services/auditService', () => ({ record: jest.fn().mockResolvedValue() }));
jest.mock('../../src/middleware/errorHandler', () => {
  class AppError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { AppError };
});
jest.mock('../../src/utils/objectId.util', () => {
  const { Types } = require('mongoose');
  return { toObjectId: (val) => (val instanceof Types.ObjectId ? val : new Types.ObjectId(val)) };
});

const { Types } = require('mongoose');
const Quiz = require('../../src/models/quiz.model');
const Course = require('../../src/models/Course');
const User = require('../../src/models/User');
const CourseUnit = require('../../src/models/CourseUnit');
const Enrollment = require('../../src/models/Enrollment');
// ===== ADD missing import =====
const QuizAttempt = require('../../src/models/quizAttempt.model');
// =============================
const auditService = require('../../src/services/auditService');
const {
  createQuiz,
  updateQuiz,
  publishQuiz,
  deleteQuiz,
  getQuizForInstructor,
  listInstructorQuizzes,
  listAvailableQuizzesForStudent,
  listQuizzesForCourseReview,
} = require('../../src/services/quiz/quiz.service');

const oid = () => new Types.ObjectId();

function mockLeanChain(resolvedValue) {
  return { lean: jest.fn().mockResolvedValue(resolvedValue) };
}

beforeEach(() => jest.resetAllMocks());

describe('createQuiz', () => {
  const instructorId = oid();
  const courseId = oid();
  const baseQuizData = {
    course_id: courseId.toString(),
    quiz_type: 'quiz',
    unit_id: oid().toString(),
    title: 'Quiz 1',
    duration_minutes: 20,
    passing_score_percent: 60,
    questions: [],
  };

  it('creates the quiz when all conditions are met', async () => {
    User.findById.mockResolvedValue({ _id: instructorId });
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    CourseUnit.findById.mockResolvedValue({
      course_id: { equals: (id) => id.toString() === courseId.toString() },
    });
    Quiz.mockImplementation(function (data) {
      Object.assign(this, data);
      this._id = oid();
      this.save = jest.fn().mockResolvedValue(this);
    });

    const result = await createQuiz({ instructorId, quizData: baseQuizData, req: {} });

    expect(result.success).toBe(true);
    expect(result.data.quiz.status).toBe('draft');
    expect(result.data.quiz.locked).toBe(false);
  });

  it('throws 404 if the instructor does not exist', async () => {
    User.findById.mockResolvedValue(null);
    await expect(
      createQuiz({ instructorId, quizData: baseQuizData, req: {} })
    ).rejects.toMatchObject({ status: 404, code: 'INSTRUCTOR_NOT_FOUND' });
  });

  it('throws 404 if the course does not exist', async () => {
    User.findById.mockResolvedValue({ _id: instructorId });
    Course.findById.mockResolvedValue(null);
    await expect(
      createQuiz({ instructorId, quizData: baseQuizData, req: {} })
    ).rejects.toMatchObject({ status: 404, code: 'COURSE_NOT_FOUND' });
  });

  it('throws 403 and logs an audit event if the instructor does not own the course', async () => {
    User.findById.mockResolvedValue({ _id: instructorId });
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: oid() });

    await expect(
      createQuiz({ instructorId, quizData: baseQuizData, req: {} })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNAUTHORIZED_QUIZ_CREATE_ATTEMPT' })
    );
  });

  it('throws 404 if the unit does not exist or does not belong to the course', async () => {
    User.findById.mockResolvedValue({ _id: instructorId });
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    CourseUnit.findById.mockResolvedValue(null);

    await expect(
      createQuiz({ instructorId, quizData: baseQuizData, req: {} })
    ).rejects.toMatchObject({ status: 404, code: 'UNIT_NOT_FOUND' });
  });

  it('throws 409 if the course already has a final exam', async () => {
    const examData = { ...baseQuizData, quiz_type: 'exam', unit_id: undefined };
    User.findById.mockResolvedValue({ _id: instructorId });
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    Quiz.findOne.mockReturnValue(mockLeanChain({ _id: oid() }));

    await expect(createQuiz({ instructorId, quizData: examData, req: {} })).rejects.toMatchObject({
      status: 409,
      code: 'EXAM_ALREADY_EXISTS',
    });
  });
});

describe('updateQuiz', () => {
  const instructorId = oid();
  const quizId = oid();

  it('updates only allowed fields, ignoring course_id/instructor_id (mass assignment guard)', async () => {
    const existingQuiz = {
      _id: quizId,
      instructor_id: instructorId,
      locked: false,
      course_id: oid(),
      title: 'Old',
      save: jest.fn().mockResolvedValue(true),
    };
    Quiz.findById.mockResolvedValue(existingQuiz);

    const maliciousCourseId = oid();
    await updateQuiz({
      quizId,
      instructorId,
      updateData: { title: 'New Title', course_id: maliciousCourseId, instructor_id: oid() },
      req: {},
    });

    expect(existingQuiz.title).toBe('New Title');
    expect(existingQuiz.course_id).not.toEqual(maliciousCourseId);
  });

  it('throws 404 if the quiz does not exist', async () => {
    Quiz.findById.mockResolvedValue(null);
    await expect(
      updateQuiz({ quizId, instructorId, updateData: {}, req: {} })
    ).rejects.toMatchObject({ status: 404, code: 'QUIZ_NOT_FOUND' });
  });

  it('throws 403 and logs an audit event if not the owner', async () => {
    Quiz.findById.mockResolvedValue({ _id: quizId, instructor_id: oid() });
    await expect(
      updateQuiz({ quizId, instructorId, updateData: {}, req: {} })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNAUTHORIZED_QUIZ_UPDATE_ATTEMPT' })
    );
  });

  it('throws 409 if the quiz is locked', async () => {
    Quiz.findById.mockResolvedValue({ _id: quizId, instructor_id: instructorId, locked: true });
    await expect(
      updateQuiz({ quizId, instructorId, updateData: { title: 'x' }, req: {} })
    ).rejects.toMatchObject({ status: 409, code: 'QUIZ_LOCKED' });
  });
});

describe('publishQuiz', () => {
  const instructorId = oid();
  const quizId = oid();

  it('publishes a draft quiz successfully', async () => {
    const quiz = {
      _id: quizId,
      instructor_id: instructorId,
      status: 'draft',
      course_id: oid(),
      save: jest.fn(),
    };
    Quiz.findById.mockResolvedValue(quiz);
    const result = await publishQuiz({ quizId, instructorId, req: {} });
    expect(result.data.quiz.status).toBe('published');
  });

  it('throws 400 if already published', async () => {
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      instructor_id: instructorId,
      status: 'published',
    });
    await expect(publishQuiz({ quizId, instructorId, req: {} })).rejects.toMatchObject({
      status: 400,
      code: 'ALREADY_PUBLISHED',
    });
  });

  it('throws 403 and logs an audit event if not the owner', async () => {
    Quiz.findById.mockResolvedValue({ _id: quizId, instructor_id: oid(), status: 'draft' });
    await expect(publishQuiz({ quizId, instructorId, req: {} })).rejects.toMatchObject({
      status: 403,
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNAUTHORIZED_QUIZ_PUBLISH_ATTEMPT' })
    );
  });
});

describe('deleteQuiz', () => {
  const instructorId = oid();
  const quizId = oid();

  it('deletes an unlocked quiz owned by the instructor', async () => {
    const quiz = {
      _id: quizId,
      instructor_id: instructorId,
      locked: false,
      course_id: oid(),
      title: 'x',
      deleteOne: jest.fn().mockResolvedValue(true),
    };
    Quiz.findById.mockResolvedValue(quiz);
    const result = await deleteQuiz({ quizId, instructorId, req: {} });
    expect(result.data.deleted).toBe(true);
    expect(quiz.deleteOne).toHaveBeenCalled();
  });

  it('throws 409 if locked', async () => {
    Quiz.findById.mockResolvedValue({ _id: quizId, instructor_id: instructorId, locked: true });
    await expect(deleteQuiz({ quizId, instructorId, req: {} })).rejects.toMatchObject({
      status: 409,
      code: 'QUIZ_LOCKED',
    });
  });
});

describe('getQuizForInstructor', () => {
  it('returns the quiz (with is_correct) to the owner only', async () => {
    const instructorId = oid();
    const quizId = oid();
    Quiz.findById.mockReturnValue(mockLeanChain({ _id: quizId, instructor_id: instructorId }));
    const result = await getQuizForInstructor({ quizId, instructorId });
    expect(result.data.quiz._id).toEqual(quizId);
  });

  it('throws 403 for a non-owner', async () => {
    const instructorId = oid();
    Quiz.findById.mockReturnValue(mockLeanChain({ _id: oid(), instructor_id: oid() }));
    await expect(getQuizForInstructor({ quizId: oid(), instructorId })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('listInstructorQuizzes', () => {
  it('caps limit at 100 and floors page at 1', async () => {
    const select = jest.fn().mockReturnThis();
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([]);
    Quiz.find.mockReturnValue({ select, sort, skip, limit, lean });
    Quiz.countDocuments.mockResolvedValue(0);

    await listInstructorQuizzes({
      instructorId: oid(),
      queryParams: { limit: '99999', page: '-5' },
    });

    expect(skip).toHaveBeenCalledWith(0);
    expect(limit).toHaveBeenCalledWith(100);
  });
});

describe('listAvailableQuizzesForStudent', () => {
  it('throws 403 if the student is not enrolled', async () => {
    Enrollment.findOne.mockResolvedValue(null);
    await expect(
      listAvailableQuizzesForStudent({ studentId: oid(), courseId: oid() })
    ).rejects.toMatchObject({ status: 403, code: 'NOT_ENROLLED' });
  });

  it('returns only published quizzes, without the questions array', async () => {
    Enrollment.findOne.mockResolvedValue({ _id: oid() });
    const select = jest.fn().mockReturnThis();
    const sort = jest.fn().mockReturnThis();
    const quizId = oid(); // create a real ObjectId for the mock
    const lean = jest.fn().mockResolvedValue([{ _id: quizId, title: 'Q1' }]);
    Quiz.find.mockReturnValue({ select, sort, lean });
    // Mock aggregate to return empty (no best attempts)
    QuizAttempt.aggregate.mockResolvedValue([]);

    const result = await listAvailableQuizzesForStudent({ studentId: oid(), courseId: oid() });
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('questions'));
    // Updated expectation: includes _id and last_result: null
    expect(result.data.quizzes).toEqual([{ _id: quizId, title: 'Q1', last_result: null }]);
  });
});

describe('listQuizzesForCourseReview', () => {
  it('excludes is_correct from the query', async () => {
    const select = jest.fn().mockReturnThis();
    const sort = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([]);
    Quiz.find.mockReturnValue({ select, sort, lean });

    await listQuizzesForCourseReview({ courseId: oid() });
    expect(select).toHaveBeenCalledWith('-questions.choices.is_correct');
  });
});
