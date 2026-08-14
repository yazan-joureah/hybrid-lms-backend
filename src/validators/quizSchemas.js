const { z } = require('zod');

const choiceSchema = z.object({
  text: z.string().trim().min(1, 'Choice text is required').max(500),
  is_correct: z.boolean(),
});

const questionSchema = z
  .object({
    question_type: z.enum(['mcq', 'true_false']),
    text: z.string().trim().min(1, 'Question text is required').max(1000),
    choices: z.array(choiceSchema).min(2, 'A question needs at least 2 choices'),
  })
  .refine((q) => q.choices.filter((c) => c.is_correct).length === 1, {
    message: 'Exactly one choice must be marked as correct',
    path: ['choices'],
  })
  .refine((q) => q.question_type !== 'true_false' || q.choices.length === 2, {
    message: 'true_false questions must have exactly 2 choices',
    path: ['choices'],
  });

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

const quizBaseObjectSchema = z.object({
  course_id: objectIdString,
  unit_id: objectIdString.optional(),
  quiz_type: z.enum(['quiz', 'exam']),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().optional(),
  start_time: z.coerce.date().nullable().optional(),
  end_time: z.coerce.date().nullable().optional(),
  duration_minutes: z.number().int().positive(),
  passing_score_percent: z.number().min(0).max(100),
  max_attempts: z.number().int().positive().optional(),
  allow_back_navigation: z.boolean().optional(),
  questions: z.array(questionSchema).min(1, 'A quiz must contain at least one question'),
});

const quizCreateSchema = quizBaseObjectSchema
  .refine((data) => !data.start_time || !data.end_time || data.end_time > data.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  })
  .refine((data) => data.quiz_type !== 'quiz' || !!data.unit_id, {
    message: 'unit_id is required when quiz_type is "quiz"',
    path: ['unit_id'],
  })
  .refine((data) => data.quiz_type !== 'exam' || !data.unit_id, {
    message: 'unit_id must not be provided when quiz_type is "exam"',
    path: ['unit_id'],
  });

const quizUpdateSchema = quizBaseObjectSchema
  .partial()
  .refine((data) => !data.start_time || !data.end_time || data.end_time > data.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  })
  .refine((data) => data.quiz_type === undefined || data.quiz_type !== 'quiz' || !!data.unit_id, {
    message: 'unit_id is required when quiz_type is "quiz"',
    path: ['unit_id'],
  })
  .refine((data) => data.quiz_type === undefined || data.quiz_type !== 'exam' || !data.unit_id, {
    message: 'unit_id must not be provided when quiz_type is "exam"',
    path: ['unit_id'],
  });

const quizIdParamSchema = z.object({ quizId: objectIdString });

const submitAnswerSchema = z.object({
  question_id: objectIdString,
  selected_choice_id: objectIdString,
});

module.exports = {
  quizCreateSchema,
  quizUpdateSchema,
  quizIdParamSchema,
  submitAnswerSchema,
};
