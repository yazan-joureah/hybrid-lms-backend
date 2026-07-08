/**
 * Generic Zod validation middleware factory.
 * On failure, returns the standard error envelope with a generic message
 * (no field-level details leaked for security-sensitive endpoints) while
 * logging the precise Zod issues server-side for debugging.
 */
const logger = require('../utils/logger');
const { ApiError } = require('./errorHandler');

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      logger.debug('Validation failed', { path: req.path, issues: result.error.issues });
      const firstIssue = result.error.issues[0];
      return next(
        new ApiError(400, 'VALIDATION_ERROR', firstIssue?.message || 'Invalid request body')
      );
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = { validateBody };
