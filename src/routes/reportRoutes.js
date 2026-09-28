// src/routes/reportRoutes.js

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const reportController = require('../controllers/reportController');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');

router.get('/me', requireAuth, requireRole(['Student']), reportController.getMyProgressSummary);

router.get(
  '/instructor/courses/:courseId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  reportController.getCourseAnalytics
);
module.exports = router;
