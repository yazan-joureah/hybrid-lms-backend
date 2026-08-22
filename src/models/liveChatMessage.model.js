/* ==========================================================================
   src/models/liveChatMessage.model.js
   UC-LIVE-06 — In-Stream Chat & Q&A
   ========================================================================== */

const mongoose = require('mongoose');

const liveChatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveSession',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['Student', 'Instructor'],
      required: true,
    },
    // نص الرسالة العادي، أو "رفع يد" — كلاهما ضمن هذا النموذج لتبسيط التخزين
    messageType: {
      type: String,
      enum: ['text', 'raise_hand', 'lower_hand'],
      default: 'text',
    },
    text: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
  },
  { timestamps: true }
);

liveChatMessageSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('LiveChatMessage', liveChatMessageSchema);
