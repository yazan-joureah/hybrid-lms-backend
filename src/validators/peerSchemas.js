// src/validators/peerSchemas.js
// Zod schemas for peer assessment API validation

const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

// Each rubric criterion: name, maximum score, weight (0-1)
const rubricCriterionSchema = z.object({
  criterion: z.string().trim().min(1).max(200),
  maxScore: z.number().positive(),
  weight: z.number().min(0).max(1),
});

/**
 * Checks that rubric weights sum to 1 (100%) with a small tolerance for floating-point errors.
 */
function rubricWeightsSumToOne(rubric) {
  const totalWeight = rubric.reduce((sum, r) => sum + r.weight, 0);
  return Math.abs(totalWeight - 1) < 0.01;
}

// UC-PEER-01 — Create Assignment
const createAssignmentSchema = z
  .object({
    courseId: objectId,
    // Optional by design — same principle as Quiz.unit_id: a PEER assignment may be
    // at the course level (no unitId), or linked to a specific unit.
    unitId: objectId.optional(),
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().trim().max(5000).optional(),
    rubric: z.array(rubricCriterionSchema).min(1, 'At least one rubric criterion is required'),
    // Both optional — PEER assignments work for both sync and async courses.
    // The temporal ordering between them is validated in assignment.service.js
    // because it depends on both values and cannot be safely checked in isolation here.
    submissionDeadline: z
      .string()
      .datetime({ message: 'submissionDeadline must be a valid ISO date-time' })
      .optional(),
    reviewDeadline: z
      .string()
      .datetime({ message: 'reviewDeadline must be a valid ISO date-time' })
      .optional(),
    reviewersPerSubmission: z.number().int().positive().max(10).optional(),
    allowFileSubmission: z.boolean().default(true),
    // Maximum number of submission attempts allowed per student.
    // Default is 3, range 1-5.
    maxAttempts: z.number().int().min(1).max(5).default(3),
  })
  .refine((data) => rubricWeightsSumToOne(data.rubric), {
    message: 'Rubric weights must sum to 1 (100%).',
    path: ['rubric'],
  });

// PATCH — Update assignment before distribution. All fields are optional (partial update).
// If rubric is sent, it must pass the same sum-of-weights validation as creation.
const updateAssignmentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    rubric: z.array(rubricCriterionSchema).min(1).optional(),
    submissionDeadline: z
      .string()
      .datetime({ message: 'submissionDeadline must be a valid ISO date-time' })
      .nullable()
      .optional(),
    reviewDeadline: z
      .string()
      .datetime({ message: 'reviewDeadline must be a valid ISO date-time' })
      .nullable()
      .optional(),
    reviewersPerSubmission: z.number().int().positive().max(10).optional(),
    allowFileSubmission: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update.',
  })
  .refine((data) => !data.rubric || rubricWeightsSumToOne(data.rubric), {
    message: 'Rubric weights must sum to 1 (100%).',
    path: ['rubric'],
  });

// Submission phase — text content is optional (a file may be sent via multer instead)
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

// Instructor: manual grade override after automated grading has run
const overrideGradeSchema = z.object({
  finalScorePercentage: z.number().min(0).max(100),
  reason: z.string().trim().max(1000).optional(),
});

module.exports = {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema,
  submitReviewSchema,
  overrideGradeSchema,
};
