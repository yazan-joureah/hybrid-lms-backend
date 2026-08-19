const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');

const verificationController = require('../controllers/cert/verification.controller');
const certificateListController = require('../controllers/cert/certificateList.controller');
const templatesController = require('../controllers/cert/templates.controller');

// public
router.get('/verify/:certificateId', verificationController.verify);

// My Certificates
router.get(
  '/my-certificates',
  requireAuth,
  requireRole(['Student']),
  requireVerifiedIdentity,
  certificateListController.listMine
);

// UC-CERT-06 — Manage Certificate Templates (SuperAdmin only)
router.get(
  '/templates',
  requireAuth,
  requireRole(['SuperAdmin']),
  requireVerifiedIdentity,
  templatesController.list
);
router.post(
  '/templates',
  requireAuth,
  requireRole(['SuperAdmin']),
  requireVerifiedIdentity,
  templatesController.create
);
router.put(
  '/templates/:templateId',
  requireAuth,
  requireRole(['SuperAdmin']),
  requireVerifiedIdentity,
  templatesController.update
);
router.delete(
  '/templates/:templateId',
  requireAuth,
  requireRole(['SuperAdmin']),
  requireVerifiedIdentity,
  templatesController.remove
);

// Download Certificate
router.get(
  '/download/:courseId',
  requireAuth,
  requireRole(['Student']),
  requireVerifiedIdentity,
  certificateListController.download
);
module.exports = router;
