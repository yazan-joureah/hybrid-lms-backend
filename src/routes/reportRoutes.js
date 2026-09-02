// src/routes/reportRoutes.js
// REPORT module — UC-REPORT-03 (Personal Progress Summary) implemented so far.
// UC-REPORT-01 (Admin Analytics) and UC-REPORT-02 (Instructor Analytics)
// will be added here later, once the modules they aggregate over
// (QUIZ scores, PAY revenue, ATT attendance) can be reviewed against
// their real service signatures.
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const reportController = require('../controllers/reportController');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');

// UC-REPORT-03 — deliberately requireAuth ONLY (no requireVerifiedIdentity):
// per the UC's own design note, a student viewing their OWN progress needs
// neither MFA nor KYC, only a valid session — minimizing friction by design.
router.get('/me', requireAuth, requireRole(['Student']), reportController.getMyProgressSummary);

// UC-REPORT-02 — precondition #1 explicitly requires MFA + KYC verified
// ("Instructor مُسجَّل دخول + MFA مفعّل + verified = KYC"), unlike
// UC-REPORT-03 above — hence requireVerifiedIdentity here.
router.get(
  '/instructor/courses/:courseId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  reportController.getCourseAnalytics
);
module.exports = router;
