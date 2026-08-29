// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');
const { createMemoryUpload } = require('../middleware/upload.util');
const { rateLimit } = require('../middleware/rateLimiter');
const { IMAGE_POLICY } = require('../config/uploadPolicies');

const { updateProfileSchema } = require('../validators/userSchemas');
const { validateBody } = require('../middleware/validate');

const uploadImage = createMemoryUpload(IMAGE_POLICY.maxFileSizeBytes, 1);

router.patch(
  '/me/profile-picture',
  requireAuth,
  rateLimit('profile-picture-upload', (req) => req.user.id),
  uploadImage.single('image'),
  userController.setMine
);

router.get('/:userId/profile-picture', userController.stream);

router.get('/me', requireAuth, userController.getMe);

router.patch('/me', requireAuth, validateBody(updateProfileSchema), userController.updateMe);

module.exports = router;
