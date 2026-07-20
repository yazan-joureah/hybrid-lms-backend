const { z } = require('zod');

const courseCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title must not exceed 200 characters'),
  description: z.string().trim().min(1, 'Description is required'),
  course_type: z.enum(['free', 'paid']),
  price: z.number().min(0).optional(),
  is_synchronous: z.boolean().optional(),
  max_students: z.number().int().positive().nullable().optional(),
  completion_threshold: z.number().min(0.0).max(1.0).optional(),
  category: z.enum([
    'Technology & Computer Science',
    'Business & Finance',
    'Health, Medicine & Wellness',
    'Arts, Design & Creative',
    'Mathematics, Science & Engineering',
    'Humanities & Social Sciences',
    'Languages',
    'Personal Development & Lifestyle',
  ]),
  prerequisite_course_ids: z
    .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format'))
    .optional(),
});

// Using .partial() makes all fields optional for the update schema
const courseUpdateSchema = courseCreateSchema.partial();

const unitCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title must not exceed 200 characters'),
});

// conditional requiredness (url required for 'link', text required
// for 'text') is intentionally NOT duplicated here — content.service.js
// already enforces it. This schema only validates shape/format when present.
const contentCreateSchema = z.object({
  content_type: z.enum(['video', 'document', 'link', 'text']),
  url: z.string().trim().url('Invalid URL format').optional(),
  text: z.string().trim().min(1, 'Text must not be empty').optional(),
});

// reason required only for 'reject' (free text) — simplest validation possible
const courseReviewSchema = z
  .object({
    decision: z.enum(['publish', 'reject', 'needs_revision']),
    reason: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.decision !== 'reject' || !!data.reason, {
    message: 'reason is required when decision is reject',
    path: ['reason'],
  });

module.exports = {
  courseCreateSchema,
  courseUpdateSchema,
  unitCreateSchema,
  contentCreateSchema,
  courseReviewSchema,
};
