/**
 * Server entrypoint — connects infra (DB/Redis) before accepting traffic.
 */
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const app = require('./app');
const env = require('./config/env');
const connectDatabase = require('./config/database');
const redisClient = require('./config/redis');
const logger = require('./utils/logger');
const { setIO } = require('./sockets/ioInstance');
const { registerLiveSocket } = require('./sockets/liveSocket');
const { registerPeerCronJobs } = require('./jobs/peerCron.job');

async function start() {
  await connectDatabase();
  await redisClient.connect().catch((err) => {
    logger.error('Failed to connect Redis', { error: err.message });
  });

  // Explicit http.Server (instead of app.listen directly) — required so that Socket.IO can share
  // the same current HTTP port instead of opening a separate port (LIVE layer — complementary
  // real-time chat/moderation, refer to src/sockets/liveSocket.js).
  const httpServer = http.createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.appUrl,
      credentials: true,
    },
  });
  setIO(io);
  registerLiveSocket(io);

  // DEVIATION: لا تُسجَّل مهام Cron أثناء الاختبارات الآلية (NODE_ENV=test) —
  // كل اختبار يفتح/يغلق اتصال DB منفصلاً، وتشغيل Cron خلفي متزامن معها قد
  // يسبب نتائج غير متوقعة (Race Conditions) في بيانات الاختبار المؤقتة.
  if (env.nodeEnv !== 'test') {
    registerPeerCronJobs();
  }

  httpServer.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} [${env.nodeEnv}] (HTTP + Socket.IO)`);
  });
}

start().catch((err) => {
  logger.error('Fatal startup error', { error: err.message });
  // eslint-disable-next-line no-process-exit -- intentional: cannot serve traffic without DB/Redis
  process.exitCode = 1;
});
