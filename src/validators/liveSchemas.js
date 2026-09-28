const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

// Create/Schedule Session
const createSessionSchema = z.object({
  courseId: objectId,
  title: z.string().trim().min(1, 'Title is required').max(200),
  meetingLink: z.string().trim().url('Invalid meeting link URL').optional().or(z.literal('')),
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO date-time' }),
  endTime: z.string().datetime({ message: 'endTime must be a valid ISO date-time' }),
  lobbyEnabled: z.boolean().optional(),
  confirmConflict: z.boolean().optional(),
  unit_id: objectId.optional().nullable(),
});

// Edit Session
const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  meetingLink: z.string().trim().url('Invalid meeting link URL').optional().or(z.literal('')),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  lobbyEnabled: z.boolean().optional(),
  confirmConflict: z.boolean().optional(),
  unit_id: objectId.optional().nullable(),
});

// Cancel Session
const cancelSessionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// Chat message
const chatMessageSchema = z.object({
  messageType: z.enum(['text', 'raise_hand', 'lower_hand']).default('text'),
  text: z.string().trim().max(2000).optional(),
});

// Toggle screen share
const screenShareSchema = z.object({
  isSharing: z.boolean(),
});

// Attach recording URL
const attachRecordingSchema = z.object({
  recordingUrl: z.string().trim().url('Invalid recording URL'),
});

const toggleStudentsAccessSchema = z.object({
  allowed: z.boolean(),
});

module.exports = {
  createSessionSchema,
  updateSessionSchema,
  cancelSessionSchema,
  chatMessageSchema,
  screenShareSchema,
  attachRecordingSchema,
  toggleStudentsAccessSchema,
};
