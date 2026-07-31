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
const payRoutes = require('./routes/payRoutes');

const env = require('./config/env');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], objectSrc: ["'none'"] },
    },
  })
);

const allowedOrigins = [env.appUrl];
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

app.use('/api/v1/pay/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(compression());

app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/pay', payRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
