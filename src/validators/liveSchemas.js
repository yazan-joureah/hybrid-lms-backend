const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

// UC-LIVE-01 — Create/Schedule Session
const createSessionSchema = z.object({
  courseId: objectId,
  title: z.string().trim().min(1, 'Title is required').max(200),
  // Allow a valid URL, an empty string, or undefined
  meetingLink: z.string().trim().url('Invalid meeting link URL').optional().or(z.literal('')),
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO date-time' }),
  endTime: z.string().datetime({ message: 'endTime must be a valid ISO date-time' }),
  lobbyEnabled: z.boolean().optional(),
  confirmConflict: z.boolean().optional(),
});

// UC-LIVE-02 — Edit Session
const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  // Allow a valid URL, an empty string, or undefined
  meetingLink: z.string().trim().url('Invalid meeting link URL').optional().or(z.literal('')),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  lobbyEnabled: z.boolean().optional(),
  confirmConflict: z.boolean().optional(),
});

// UC-LIVE-02 — Cancel Session
const cancelSessionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// UC-LIVE-06 — Chat message
const chatMessageSchema = z.object({
  messageType: z.enum(['text', 'raise_hand', 'lower_hand']).default('text'),
  text: z.string().trim().max(2000).optional(),
});

// UC-LIVE-07 — Toggle screen share
const screenShareSchema = z.object({
  isSharing: z.boolean(),
});

// UC-LIVE-08 — Attach recording URL
const attachRecordingSchema = z.object({
  recordingUrl: z.string().trim().url('Invalid recording URL'),
});

module.exports = {
  createSessionSchema,
  updateSessionSchema,
  cancelSessionSchema,
  chatMessageSchema,
  screenShareSchema,
  attachRecordingSchema,
};
