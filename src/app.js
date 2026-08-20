const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const kycRoutes = require('./routes/kycRoutes');
const courseRoutes = require('./routes/courseRoutes');
const adminRoutes = require('./routes/adminRoutes');
const liveRoutes = require('./routes/liveRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const peerRoutes = require('./routes/peerRoutes');
const payRoutes = require('./routes/payRoutes');
const quizRoutes = require('./routes/quizRoutes');
const userRoutes = require('./routes/userRoutes');

// 1. Import your custom rate limiter
const { rateLimit } = require('./middleware/rateLimiter');

const env = require('./config/env');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], objectSrc: ["'none'"] },
    },
  })
);

const allowedOrigins = [env.appUrl, 'http://localhost:5173'];
if (env.nodeEnv !== 'production' && process.env.DEMO_FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.DEMO_FRONTEND_ORIGIN);
}
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// We keep the Stripe webhook BEFORE the global JSON parser and BEFORE
// the global rate limiter to ensure Stripe events are never blocked by IP
app.use('/api/v1/pay/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(compression());

// 2. Apply the global baseline rate limiter to all API endpoints
if (env.nodeEnv !== 'test') {
  app.use(
    '/api/v1',
    rateLimit('global-api', (req) => req.ip)
  );
}

app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/live', liveRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/peer', peerRoutes);
app.use('/api/v1/pay', payRoutes);
app.use('/api/v1/quizzes', quizRoutes);
app.use('/api/v1/users', userRoutes);

// ── 404 + Error handling (must be last) ──────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
