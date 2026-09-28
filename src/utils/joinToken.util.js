const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../middleware/errorHandler');

const JOIN_TOKEN_TTL_SECONDS = 5 * 60;

function signJoinToken({ studentId, sessionId, courseId }) {
  const payload = {
    studentId: String(studentId),
    sessionId: String(sessionId),
    type: 'live_join',
  };

  if (courseId) {
    payload.courseId = String(courseId);
  }

  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: JOIN_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

function verifyJoinToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.accessSecret, {
      algorithms: ['HS256'],
    });

    if (payload.type !== 'live_join') {
      throw new AppError(401, 'INVALID_TOKEN_TYPE', 'نوع رمز الانضمام غير صحيح.');
    }

    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_JOIN_TOKEN', 'رمز الانضمام غير صالح أو منتهي الصلاحية.');
  }
}

module.exports = {
  signJoinToken,
  verifyJoinToken,
  JOIN_TOKEN_TTL_SECONDS,
};
