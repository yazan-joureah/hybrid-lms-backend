// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');
const { createMemoryUpload } = require('../middleware/upload.util');
const { rateLimit } = require('../middleware/rateLimiter');

const uploadImage = createMemoryUpload(5 * 1024 * 1024, 1);

router.patch(
  '/me/profile-picture',
  requireAuth,
  rateLimit('profile-picture-upload', (req) => req.user.id),
  uploadImage.single('image'),
  userController.setMine
);

router.get('/:userId/profile-picture', userController.stream);

router.get('/me', requireAuth, userController.getMe);

module.exports = router;
