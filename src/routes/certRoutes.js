const express = require('express');
const cors = require('cors');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');

const verificationController = require('../controllers/cert/verification.controller');
const certificateListController = require('../controllers/cert/certificateList.controller');

const openCors = cors({ origin: true, credentials: false });

// public — returns status + (when valid) the signed VC-JWT in one call
router.get('/verify/:certificateId', openCors, verificationController.verify);

router.get(
  '/my-certificates',
  requireAuth,
  requireRole(['Student']),
  requireVerifiedIdentity,
  certificateListController.listMine
);

router.get(
  '/download/:courseId',
  requireAuth,
  requireRole(['Student']),
  requireVerifiedIdentity,
  certificateListController.download
);

module.exports = router;
