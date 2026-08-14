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
  title: z.string().trim().min(1, 'Title is required').max(200),
  desc: z.string().trim().optional(),
});

const contentCreateSchema = z.object({
  content_type: z.enum(['video', 'document', 'link', 'text']),
  title: z.string().trim().min(1, 'Title is required').max(200),
  desc: z.string().trim().optional(),
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

const progressSchema = z.object({
  content_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format'),
});

const updateUnitSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200).optional(),
    desc: z.string().trim().optional(),
  })
  .refine((data) => data.title !== undefined || data.desc !== undefined, {
    message: 'At least one field (title or desc) must be provided',
  });

const reorderUnitsSchema = z.object({
  ordered_unit_ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1),
});

const updateContentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  desc: z.string().trim().optional(),
  url: z.string().trim().url('Invalid URL format').optional(),
  text: z.string().trim().min(1).optional(),
});

const reorderContentSchema = z.object({
  ordered_content_ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1),
});

const courseStatusSchema = z.object({
  status: z.enum(['suspended', 'archived']),
});

module.exports = {
  courseCreateSchema,
  courseUpdateSchema,
  unitCreateSchema,
  contentCreateSchema,
  courseReviewSchema,
  progressSchema,
  updateUnitSchema,
  reorderUnitsSchema,
  updateContentSchema,
  reorderContentSchema,
  courseStatusSchema,
};
