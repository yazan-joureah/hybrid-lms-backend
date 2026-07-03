/**
 * Server entrypoint — connects infra (DB/Redis) before accepting traffic.
 */
const app = require('./app');
const env = require('./config/env');
const connectDatabase = require('./config/database');
const redisClient = require('./config/redis');
const logger = require('./utils/logger');

async function start() {
  await connectDatabase();
  await redisClient.connect().catch((err) => {
    logger.error('Failed to connect Redis', { error: err.message });
  });

  app.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} [${env.nodeEnv}]`);
  });
}

start().catch((err) => {
  logger.error('Fatal startup error', { error: err.message });
  // eslint-disable-next-line no-process-exit -- intentional: cannot serve traffic without DB/Redis
  process.exit(1);
});
