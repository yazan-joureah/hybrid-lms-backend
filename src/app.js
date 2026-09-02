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
const certRoutes = require('./routes/certRoutes');
const reportRoutes = require('./routes/reportRoutes');
const { AppError } = require('./middleware/errorHandler');

const env = require('./config/env');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], objectSrc: ["'none'"] },
    },
  })
);

// ✅ localhost:8443/5173 مقيّدة الآن بالتطوير فقط — كانت مكتوبة بشكل
// ثابت بدون شرط بيئة، يعني كانت مسموحة حتى بالإنتاج (ثغرة CORS).
const allowedOrigins = [env.appUrl];
if (env.nodeEnv !== 'production') {
  allowedOrigins.push('http://localhost:8443', 'http://localhost:5173');
}
if (process.env.DEMO_FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.DEMO_FRONTEND_ORIGIN);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'CORS_NOT_ALLOWED', 'Cross-origin request blocked.'));
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
app.use('/api/v1/certificates', certRoutes);
app.use('/api/v1/report', reportRoutes);
// ── 404 + Error handling (must be last) ──────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
