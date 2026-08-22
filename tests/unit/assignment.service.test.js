// tests/unit/assignment.service.test.js

jest.mock('../../src/models/peerAssignment.model');
jest.mock('../../src/models/Course');
jest.mock('../../src/models/CourseUnit');
jest.mock('../../src/models/Enrollment');
jest.mock('../../src/models/peerSubmission.model');
jest.mock('../../src/services/auditService', () => ({ record: jest.fn().mockResolvedValue() }));
jest.mock('../../src/services/peer/lifecycle.service', () => ({
  ensureAssignmentUpToDate: jest.fn().mockResolvedValue({ assignment: {}, pendingIssue: null }),
}));
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
const PeerAssignment = require('../../src/models/peerAssignment.model');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const PeerSubmission = require('../../src/models/peerSubmission.model');
const auditService = require('../../src/services/auditService');
const { ensureAssignmentUpToDate } = require('../../src/services/peer/lifecycle.service');
const {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  loadOwnedAssignment,
} = require('../../src/services/peer/assignment.service');

const oid = () => new Types.ObjectId();
beforeEach(() => {
  jest.resetAllMocks();
  // resetAllMocks clears the implementation defined in the factory above —
  // must be re‑assigned in every beforeEach, not just when the module is loaded.
  ensureAssignmentUpToDate.mockResolvedValue({ assignment: {}, pendingIssue: null });
});

const RUBRIC = [
  { criterion: 'A', maxScore: 10, weight: 0.5 },
  { criterion: 'B', maxScore: 10, weight: 0.5 },
];

describe('createAssignment — unitId branch (optional, like Quiz.unit_id)', () => {
  const instructorId = oid();
  const courseId = oid();
  const baseData = { courseId: courseId.toString(), title: 'T', rubric: RUBRIC };

  it('creates successfully with no unitId at all (course-level assignment)', async () => {
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    PeerAssignment.create.mockResolvedValue({ _id: oid(), toObject: () => ({}) });

    const result = await createAssignment({ instructorId, assignmentData: baseData, req: {} });
    expect(result.success).toBe(true);
    expect(CourseUnit.findById).not.toHaveBeenCalled();
  });

  it('validates the unit belongs to the course when unitId is provided', async () => {
    const unitId = oid();
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    CourseUnit.findById.mockResolvedValue({
      course_id: { equals: (id) => id.toString() === courseId.toString() },
    });
    PeerAssignment.create.mockResolvedValue({ _id: oid(), toObject: () => ({}) });

    const result = await createAssignment({
      instructorId,
      assignmentData: { ...baseData, unitId: unitId.toString() },
      req: {},
    });
    expect(result.success).toBe(true);
  });

  it('throws 404 UNIT_NOT_FOUND when unitId does not belong to the course', async () => {
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    CourseUnit.findById.mockResolvedValue(null);

    await expect(
      createAssignment({
        instructorId,
        assignmentData: { ...baseData, unitId: oid().toString() },
        req: {},
      })
    ).rejects.toMatchObject({ status: 404, code: 'UNIT_NOT_FOUND' });
  });
});

describe('createAssignment — deadline branches (all optional now)', () => {
  const instructorId = oid();
  const courseId = oid();
  const baseData = { courseId: courseId.toString(), title: 'T', rubric: RUBRIC };

  beforeEach(() => {
    Course.findById.mockResolvedValue({ _id: courseId, owner_instructor_id: instructorId });
    PeerAssignment.create.mockResolvedValue({ _id: oid(), toObject: () => ({}) });
  });

  it('creates successfully with NO deadlines at all (async course)', async () => {
    const result = await createAssignment({ instructorId, assignmentData: baseData, req: {} });
    expect(result.success).toBe(true);
  });

  it('throws INVALID_REVIEW_DEADLINE when reviewDeadline given without submissionDeadline', async () => {
    await expect(
      createAssignment({
        instructorId,
        assignmentData: {
          ...baseData,
          reviewDeadline: new Date(Date.now() + 60000).toISOString(),
        },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_DEADLINE' });
  });

  it('throws INVALID_SUBMISSION_DEADLINE for a past submissionDeadline', async () => {
    await expect(
      createAssignment({
        instructorId,
        assignmentData: {
          ...baseData,
          submissionDeadline: new Date(Date.now() - 60000).toISOString(),
        },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_SUBMISSION_DEADLINE' });
  });

  it('throws INVALID_REVIEW_DEADLINE when reviewDeadline <= submissionDeadline', async () => {
    const submissionDeadline = new Date(Date.now() + 60000).toISOString();
    await expect(
      createAssignment({
        instructorId,
        assignmentData: { ...baseData, submissionDeadline, reviewDeadline: submissionDeadline },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_DEADLINE' });
  });
});

describe('loadOwnedAssignment', () => {
  const instructorId = oid();
  const assignmentId = oid();

  it('throws 404 ASSIGNMENT_NOT_FOUND when missing', async () => {
    PeerAssignment.findById.mockResolvedValue(null);
    await expect(loadOwnedAssignment(assignmentId, instructorId, {})).rejects.toMatchObject({
      status: 404,
      code: 'ASSIGNMENT_NOT_FOUND',
    });
  });

  it('throws 403 FORBIDDEN and logs audit when not the owner', async () => {
    PeerAssignment.findById.mockResolvedValue({ instructorId: oid() });
    await expect(
      loadOwnedAssignment(assignmentId, instructorId, {
        unauthorizedAction: 'UNAUTHORIZED_PEER_ASSIGNMENT_UPDATE_ATTEMPT',
      })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNAUTHORIZED_PEER_ASSIGNMENT_UPDATE_ATTEMPT' })
    );
  });

  it('does NOT log audit when unauthorizedAction is not provided', async () => {
    PeerAssignment.findById.mockResolvedValue({ instructorId: oid() });
    await expect(loadOwnedAssignment(assignmentId, instructorId, {})).rejects.toMatchObject({
      status: 403,
    });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('returns the assignment when the instructor is the owner', async () => {
    const assignment = { instructorId };
    PeerAssignment.findById.mockResolvedValue(assignment);
    const result = await loadOwnedAssignment(assignmentId, instructorId, {});
    expect(result).toBe(assignment);
  });
});

describe('updateAssignment', () => {
  const instructorId = oid();
  const assignmentId = oid();

  it('throws 409 ASSIGNMENT_LOCKED once status is no longer open', async () => {
    PeerAssignment.findById.mockResolvedValue({ instructorId, status: 'distributed' });
    await expect(
      updateAssignment({ instructorId, assignmentId, updateData: { title: 'x' }, req: {} })
    ).rejects.toMatchObject({ status: 409, code: 'ASSIGNMENT_LOCKED' });
  });

  it('updates only whitelisted fields (mass-assignment guard)', async () => {
    const assignment = {
      instructorId,
      status: 'open',
      title: 'Old',
      submissionDeadline: null,
      reviewDeadline: null,
      save: jest.fn().mockResolvedValue(true),
    };
    PeerAssignment.findById.mockResolvedValue(assignment);

    await updateAssignment({
      instructorId,
      assignmentId,
      updateData: { title: 'New', instructorId: oid(), courseId: oid() },
      req: {},
    });

    expect(assignment.title).toBe('New');
    expect(assignment.instructorId).toBe(instructorId); // untouched — not in UPDATABLE_FIELDS
  });

  it('allows clearing submissionDeadline explicitly via null', async () => {
    const assignment = {
      instructorId,
      status: 'open',
      submissionDeadline: new Date(Date.now() + 60000),
      reviewDeadline: null,
      save: jest.fn().mockResolvedValue(true),
    };
    PeerAssignment.findById.mockResolvedValue(assignment);

    await updateAssignment({
      instructorId,
      assignmentId,
      updateData: { submissionDeadline: null },
      req: {},
    });
    expect(assignment.submissionDeadline).toBeNull();
  });

  it('throws INVALID_REVIEW_DEADLINE when reviewDeadline set without submissionDeadline (existing or new)', async () => {
    const assignment = {
      instructorId,
      status: 'open',
      submissionDeadline: null,
      reviewDeadline: null,
      save: jest.fn(),
    };
    PeerAssignment.findById.mockResolvedValue(assignment);

    await expect(
      updateAssignment({
        instructorId,
        assignmentId,
        updateData: { reviewDeadline: new Date(Date.now() + 60000).toISOString() },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_DEADLINE' });
  });

  it('throws INVALID_SUBMISSION_DEADLINE for a past date', async () => {
    const assignment = { instructorId, status: 'open', save: jest.fn() };
    PeerAssignment.findById.mockResolvedValue(assignment);

    await expect(
      updateAssignment({
        instructorId,
        assignmentId,
        updateData: { submissionDeadline: new Date(Date.now() - 1000).toISOString() },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_SUBMISSION_DEADLINE' });
  });

  it('throws INVALID_REVIEW_DEADLINE when new reviewDeadline <= existing submissionDeadline', async () => {
    const submissionDeadline = new Date(Date.now() + 60000);
    const assignment = { instructorId, status: 'open', submissionDeadline, save: jest.fn() };
    PeerAssignment.findById.mockResolvedValue(assignment);

    await expect(
      updateAssignment({
        instructorId,
        assignmentId,
        updateData: { reviewDeadline: submissionDeadline.toISOString() },
        req: {},
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_DEADLINE' });
  });
});

describe('deleteAssignment', () => {
  const instructorId = oid();
  const assignmentId = oid();

  it('throws 409 ASSIGNMENT_LOCKED once distributed', async () => {
    PeerAssignment.findById.mockResolvedValue({ instructorId, status: 'distributed' });
    await expect(deleteAssignment({ instructorId, assignmentId, req: {} })).rejects.toMatchObject({
      status: 409,
      code: 'ASSIGNMENT_LOCKED',
    });
  });

  it('throws 409 ASSIGNMENT_HAS_SUBMISSIONS when submissions already exist', async () => {
    PeerAssignment.findById.mockResolvedValue({ instructorId, status: 'open' });
    PeerSubmission.countDocuments.mockResolvedValue(2);

    await expect(deleteAssignment({ instructorId, assignmentId, req: {} })).rejects.toMatchObject({
      status: 409,
      code: 'ASSIGNMENT_HAS_SUBMISSIONS',
    });
  });

  it('deletes successfully when open and no submissions exist', async () => {
    const assignment = {
      instructorId,
      status: 'open',
      courseId: oid(),
      title: 'x',
      deleteOne: jest.fn().mockResolvedValue(true),
    };
    PeerAssignment.findById.mockResolvedValue(assignment);
    PeerSubmission.countDocuments.mockResolvedValue(0);

    const result = await deleteAssignment({ instructorId, assignmentId, req: {} });
    expect(result.data.deleted).toBe(true);
    expect(assignment.deleteOne).toHaveBeenCalled();
  });
});
