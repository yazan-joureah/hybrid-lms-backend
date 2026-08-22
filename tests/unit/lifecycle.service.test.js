jest.mock('../../src/services/peer/allocation.service');
jest.mock('../../src/services/peer/grading.service');
jest.mock('../../src/models/Course');
jest.mock('../../src/models/peerSubmission.model');
jest.mock('../../src/models/peerAssignment.model'); // دفاعي: يُستخدم في مسار "stuck distributing" غير المُختبر حالياً

const allocationService = require('../../src/services/peer/allocation.service');
const gradingService = require('../../src/services/peer/grading.service');
const Course = require('../../src/models/Course');
const PeerSubmission = require('../../src/models/peerSubmission.model');
const { ensureAssignmentUpToDate } = require('../../src/services/peer/lifecycle.service');

beforeEach(() => {
  jest.resetAllMocks();
  // قيم افتراضية آمنة لسلسلة .findById().select().lean() و .find().select().lean()
  // resetAllMocks يمسح أي mockReturnValue سابق، لذا يجب إعادة ضبطها في كل اختبار
  Course.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
  PeerSubmission.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });
});

describe('ensureAssignmentUpToDate', () => {
  it('returns immediately when assignment is null', async () => {
    const result = await ensureAssignmentUpToDate({ assignment: null });
    expect(result).toEqual({ assignment: null, pendingIssue: null });
  });

  it('does nothing when status=open with no submissionDeadline (async, no auto-transition)', async () => {
    const assignment = { status: 'open', submissionDeadline: null };
    const result = await ensureAssignmentUpToDate({ assignment });
    expect(allocationService.distributeReviews).not.toHaveBeenCalled();
    expect(result.pendingIssue).toBeNull();
  });

  it('does nothing when status=open and submissionDeadline is in the future', async () => {
    const assignment = { status: 'open', submissionDeadline: new Date(Date.now() + 60000) };
    await ensureAssignmentUpToDate({ assignment });
    expect(allocationService.distributeReviews).not.toHaveBeenCalled();
  });

  it('triggers distributeReviews once submissionDeadline has passed', async () => {
    const assignment = {
      _id: 'a1',
      status: 'open',
      submissionDeadline: new Date(Date.now() - 1000),
    };
    allocationService.distributeReviews.mockResolvedValue({
      data: { assignment: { status: 'distributed' } },
    });

    const result = await ensureAssignmentUpToDate({ assignment });
    expect(allocationService.distributeReviews).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: 'a1', actorRole: 'System' })
    );
    expect(result.assignment.status).toBe('distributed');
  });

  it('does nothing when status=distributed with no reviewDeadline', async () => {
    const assignment = { status: 'distributed', reviewDeadline: null };
    await ensureAssignmentUpToDate({ assignment });
    expect(gradingService.calculateFinalGrades).not.toHaveBeenCalled();
  });

  it('triggers calculateFinalGrades once reviewDeadline has passed', async () => {
    const assignment = {
      _id: 'a2',
      status: 'distributed',
      reviewDeadline: new Date(Date.now() - 1000),
    };
    gradingService.calculateFinalGrades.mockResolvedValue({
      data: { assignment: { status: 'completed' } },
    });

    const result = await ensureAssignmentUpToDate({ assignment });
    expect(gradingService.calculateFinalGrades).toHaveBeenCalled();
    expect(result.assignment.status).toBe('completed');
  });

  it('returns pendingIssue with err.code (never message/stack) on failure — no crash', async () => {
    const assignment = {
      _id: 'a3',
      status: 'open',
      submissionDeadline: new Date(Date.now() - 1000),
    };
    const err = new Error('internal details should not leak');
    err.code = 'INSUFFICIENT_SUBMISSIONS';
    allocationService.distributeReviews.mockRejectedValue(err);

    const result = await ensureAssignmentUpToDate({ assignment });
    expect(result.pendingIssue).toBe('INSUFFICIENT_SUBMISSIONS');
    expect(result.assignment).toBe(assignment); // original returned, unmodified
  });

  it('falls back to LIFECYCLE_CHECK_FAILED when the error has no .code', async () => {
    const assignment = {
      _id: 'a4',
      status: 'distributed',
      reviewDeadline: new Date(Date.now() - 1000),
    };
    gradingService.calculateFinalGrades.mockRejectedValue(new Error('no code here'));

    const result = await ensureAssignmentUpToDate({ assignment });
    expect(result.pendingIssue).toBe('LIFECYCLE_CHECK_FAILED');
  });

  it('does nothing for status=completed (terminal state)', async () => {
    const assignment = { status: 'completed' };
    const result = await ensureAssignmentUpToDate({ assignment });
    expect(allocationService.distributeReviews).not.toHaveBeenCalled();
    expect(gradingService.calculateFinalGrades).not.toHaveBeenCalled();
    expect(result.pendingIssue).toBeNull();
  });
});
