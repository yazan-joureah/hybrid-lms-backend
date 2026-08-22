// tests/unit/peerSchemas.test.js (إضافة، أو ملف جديد إن لم يوجد)
const { updateAssignmentSchema } = require('../../src/validators/peerSchemas');

describe('updateAssignmentSchema', () => {
  it('rejects an empty update body', () => {
    expect(updateAssignmentSchema.safeParse({}).success).toBe(false);
  });

  it('passes when rubric is omitted entirely (branch: !data.rubric short-circuit)', () => {
    expect(updateAssignmentSchema.safeParse({ title: 'New title' }).success).toBe(true);
  });

  it('rejects when rubric IS provided but weights do not sum to 1', () => {
    const result = updateAssignmentSchema.safeParse({
      rubric: [{ criterion: 'A', maxScore: 10, weight: 0.3 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts null to explicitly clear a deadline', () => {
    expect(updateAssignmentSchema.safeParse({ submissionDeadline: null }).success).toBe(true);
  });
});
