// src/validators/attendanceSchemas.js
const { z } = require('zod');

const correctAttendanceSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});

module.exports = { correctAttendanceSchema };
