const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

const rubricCriterionSchema = z.object({
  criterion: z.string().trim().min(1).max(200),
  maxScore: z.number().positive(),
  weight: z.number().min(0).max(1),
});

// UC-PEER-01 — Create Assignment
const createAssignmentSchema = z
  .object({
    courseId: objectId,
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().trim().max(5000).optional(),
    rubric: z.array(rubricCriterionSchema).min(1, 'At least one rubric criterion is required'),
    submissionDeadline: z.string().datetime({ message: 'submissionDeadline must be a valid ISO date-time' }),
    reviewDeadline: z.string().datetime({ message: 'reviewDeadline must be a valid ISO date-time' }),
    reviewersPerSubmission: z.number().int().positive().max(10).optional(),
  })
  .refine((data) => {
    const totalWeight = data.rubric.reduce((sum, r) => sum + r.weight, 0);
    return Math.abs(totalWeight - 1) < 0.01; // تسامح بسيط لأخطاء الفاصلة العائمة
  }, 'Rubric weights must sum to 1 (100%).');

// مرحلة التسليم — النص اختياري (قد يُرسَل ملف فقط عبر multer بدلاً منه)
const submitAssignmentSchema = z.object({
  textContent: z.string().trim().max(20000).optional(),
});

// UC-PEER-03 — Submit Review
const reviewScoreSchema = z.object({
  criterion: z.string().trim().min(1),
  score: z.number().min(0),
});

const submitReviewSchema = z.object({
  scores: z.array(reviewScoreSchema).min(1, 'At least one score is required'),
  feedbackText: z.string().trim().max(5000).optional(),
});

module.exports = {
  createAssignmentSchema,
  submitAssignmentSchema,
  submitReviewSchema,
};
