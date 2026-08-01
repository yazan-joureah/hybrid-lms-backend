/* ==========================================================================
   src/routes/liveRoutes.js
   ========================================================================== */

const express = require('express');
const router = express.Router();
const _mongoose = require('mongoose');

// استيراد Controller و Middleware الأساسي
const { joinSession } = require('../controllers/live.controller');
const { requireAuth } = require('../middleware/authMiddleware');
const User = require('../models/User');

// Middleware للتحقق من دور الطالب (يدعم String و ObjectId)
const requireStudentRole = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only students can perform this action.',
      });
    }

    // 1. البحث باستخدام الموديل الافتراضي (Mongoose تحوله لـ ObjectId تلقائياً)
    let user = await User.findById(req.user.id);

    // 2. إذا لم يجده، نبحث بالـ String المباشر (في حال تخزينه كـ String في Mongo Express)
    if (!user) {
      user = await User.findOne({ _id: String(req.user.id) });
    }

    // 3. التحقق من وجود المستخدم وأن دوره الطالب
    if (user && user.role && user.role.toLowerCase() === 'student') {
      req.user.role = user.role;
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Only students can perform this action.',
    });
  } catch (error) {
    console.error('Error in requireStudentRole:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during authorization check.',
    });
  }
};

// مسار الانضمام للجلسة المباشرة (UC-LIVE-01)
router.post('/sessions/:sessionId/join', requireAuth, requireStudentRole, joinSession);

module.exports = router;
