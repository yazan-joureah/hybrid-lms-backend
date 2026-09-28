//Centralized error handler.

const logger = require('../utils/logger');

class AppError extends Error {
  constructor(statusCode, code, message, clientData = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.clientData = clientData;
  }
}

const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: 'The uploaded file exceeds the maximum allowed size.',
  LIMIT_FILE_COUNT: 'Too many files uploaded in a single request.',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field in the upload request.',
};

function errorHandler(err, req, res, _next) {
  if (err.name === 'MulterError') {
    const message = MULTER_ERROR_MESSAGES[err.code] || 'File upload failed.';
    err = new AppError(400, err.code, message);
  }

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
