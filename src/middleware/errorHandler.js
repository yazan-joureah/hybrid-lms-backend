/**
 * Centralized error handler.
 * Returns the standard API error envelope defined in REST_API_Contract_v1.2:
 *   { success: false, error: { code, message } }
 * Never leaks stack traces or internal details to the client (OWASP A09).
 */
const logger = require('../utils/logger');

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = statusCode === 500 ? 'An unexpected error occurred' : err.message;

  if (statusCode === 500) {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
}

module.exports = { errorHandler, notFoundHandler, ApiError };
