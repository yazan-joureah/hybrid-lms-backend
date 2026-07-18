/**
 * Centralized error handler.
 * Returns the standard API error envelope: { success: false, error: { code, message } }
 * Never leaks stack traces or internal details (OWASP A09).
 */
const logger = require('../utils/logger');

class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code - machine-readable error code (e.g. 'INVALID_CREDENTIALS')
   * @param {string} message - safe, user-facing message (never internal details)
   * @param {object|null} clientData - extra fields merged into response.data (e.g. { next_step: 'verify_email' })
   */
  constructor(statusCode, code, message, clientData = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.clientData = clientData;
  }
}

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = statusCode === 500 ? 'An unexpected error occurred' : err.message;

  if (statusCode === 500) {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  }

  const body = { success: false, error: { code, message } };
  if (err.clientData) {
    body.data = err.clientData;
  }

  res.status(statusCode).json(body);
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
}

module.exports = { errorHandler, notFoundHandler, AppError };
