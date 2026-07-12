/**
 * Express application setup — security middleware chain (OWASP baseline).
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');

const env = require('./config/env');

const app = express();

// ── Security headers (Helmet — explicit CSP per project security policy) ──
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  })
);

// Place this BEFORE your routes (e.g., app.use('/api/v1', ...))
app.use(
  cors({
    origin: env.appUrl,
    credentials: true,
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(compression());

// ── Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);

// ── 404 + Error handling (must be last) ──────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
