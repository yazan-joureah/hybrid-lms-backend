const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const encryptedMessageSchema = new Schema(
  {
    sender: { type: String, enum: ['user', 'assistant'], required: true },
    ciphertext: { type: Buffer, required: true },
    flagged: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const aiConversationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['Student', 'Instructor'], required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },

    systemPromptSnapshot: { type: String, required: true },

    messages: { type: [encryptedMessageSchema], default: [] },

    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

aiConversationSchema.index({ userId: 1, courseId: 1 }, { unique: true });

applyReferentialIntegrity(aiConversationSchema, [
  { path: 'userId', ref: 'User', required: true },
  { path: 'courseId', ref: 'Course', required: true },
]);

module.exports = mongoose.model('AIConversation', aiConversationSchema);
