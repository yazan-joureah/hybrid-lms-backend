// src/sockets/liveSocket.js

const { verifyJoinToken } = require('../utils/joinToken.util');
const { recordAttendanceLeave } = require('../services/attendance/tracking.service');
const logger = require('../utils/logger');

function registerLiveSocket(io) {
  const nsp = io.of('/live');

  nsp.use((socket, next) => {
    try {
      const { joinToken } = socket.handshake.auth || {};
      if (!joinToken) return next(new Error('joinToken is required'));
      const payload = verifyJoinToken(joinToken);
      socket.data.identity = { userId: payload.studentId, sessionId: payload.sessionId };
      return next();
    } catch (err) {
      return next(new Error('Unauthorized socket connection'));
    }
  });

  nsp.on('connection', (socket) => {
    const { userId, sessionId } = socket.data.identity;
    logger.info('Live socket connected', { userId, sessionId });

    socket.on('disconnect', async () => {
      logger.info('Live socket disconnected', { userId, sessionId });
      try {
        await recordAttendanceLeave({ studentId: userId, sessionId });
      } catch (err) {
        logger.debug('Best-effort attendance leave on disconnect skipped', { error: err.message });
      }
    });
  });

  return nsp;
}

module.exports = { registerLiveSocket };
