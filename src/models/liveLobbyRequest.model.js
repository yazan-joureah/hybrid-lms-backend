/* ==========================================================================
   src/models/liveLobbyRequest.model.js
   UC-LIVE-05 — Lobby Control
   ========================================================================== */

const mongoose = require('mongoose');

const liveLobbyRequestSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveSession',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'admitted', 'denied'],
      default: 'waiting',
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    decidedByInstructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// طلب انتظار واحد فعّال لكل طالب لكل جلسة (تُعاد نفس الحالة عند إعادة المحاولة بدل التكرار)
liveLobbyRequestSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('LiveLobbyRequest', liveLobbyRequestSchema);
