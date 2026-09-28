const logger = require('../utils/logger');
const { AppError } = require('./errorHandler');

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      logger.debug('Validation failed', { path: req.path, issues: result.error.issues });
      const firstIssue = result.error.issues[0];
      return next(
        new AppError(400, 'VALIDATION_ERROR', firstIssue?.message || 'Invalid request body')
      );
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = { validateBody };
