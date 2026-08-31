const express = require('express');
const cors = require('cors');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');

const verificationController = require('../controllers/cert/verification.controller');
const certificateListController = require('../controllers/cert/certificateList.controller');

// ✅ صريح تمامًا: origin '*' الحرفية (مو boolean true) + credentials: false
// — هذا الراوت عام بالكامل (يُفتح من طرف ثالث مجهول عبر مسح QR)، ولا يجب
// أن يحمل أي دلالة على كوكيز/جلسة. الفرونت (certService.ts) بدوره يستدعي
// هذا الـ endpoint بـ withCredentials: false — التطابق بين الطرفين هو ما
// يمنع تضارب هيدرز CORS اللي كان يسبب رفض المتصفح للاستجابة.
const publicCors = cors({ origin: '*', credentials: false });

// يمنع أي تخزين مؤقت للاستجابة أو لهيدرز CORS تبعها.
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

// public — returns status + (when valid) the signed VC-JWT in one call
router.get('/verify/:certificateId', publicCors, noStore, verificationController.verify);

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
