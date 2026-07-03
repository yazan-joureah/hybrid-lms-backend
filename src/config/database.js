/**
 * MongoDB connection via Mongoose.
 * Retries on failure — fails fast in production, retries in dev.
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const env = require('./env');

async function connectDatabase() {
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(env.mongoUri);
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error('MongoDB connection failed', { error: err.message });
    throw err;
  }

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

module.exports = connectDatabase;
