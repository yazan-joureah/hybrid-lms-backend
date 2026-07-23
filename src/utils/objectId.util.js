// src/utils/objectId.util.js
/**
 * Casts a value to a Mongoose ObjectId, throwing a clean 400 AppError
 * instead of an unhandled Mongoose CastError (which would otherwise
 * surface as a generic 500). Also acts as an explicit sanitization
 * boundary right at the query site  regardless of what
 * upstream validation (Zod, params) may or may not have already done.
 */
const mongoose = require('mongoose');
const { AppError } = require('../middleware/errorHandler');

function toObjectId(value, fieldName = 'id') {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${fieldName} format.`);
  }
  return new mongoose.Types.ObjectId(value);
}

module.exports = { toObjectId };
