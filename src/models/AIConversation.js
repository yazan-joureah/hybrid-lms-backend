/* ==========================================================================
   src/models/AIConversation.js
   UC-AI-01/04 (بدء الجلسة) + UC-AI-02/05/06 (الاستعلامات) + UC-AI-03 (السجل)
   ========================================================================== */

const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

// كل رسالة (من المستخدم أو من المساعد) تُخزَّن مُشفَّرة AES-256-GCM بمفتاح
// مشتَق من userId عبر crypto.encryptForUser — نفس الآلية المستخدَمة أصلاً
// لتشفير وثائق KYC (FR-47)، بدل بناء طبقة تشفير جديدة من الصفر.
const encryptedMessageSchema = new Schema(
  {
    sender: { type: String, enum: ['user', 'assistant'], required: true },
    ciphertext: { type: Buffer, required: true }, // [iv|authTag|ciphertext] خام — راجع crypto.js
    // علم تحذيري: حُقن Prompt مرصود، أو طلب إجابة امتحان مباشرة، أو انتهاك
    // خصوصية في مخرجات المساعد — لا يُخزَّن السبب التفصيلي هنا لتفادي أي
    // تسريب لاحق؛ التفاصيل الكاملة تُسجَّل في AuditLog حصراً.
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

    // النص الثابت المحقون (SF-AI-01/SF-AI-02) + سياق الكورس وقت آخر بدء
    // جلسة — يُعاد بناؤه بالكامل من الخادم في كل UC-AI-01/04، ولا يُقبَل
    // منه أي جزء من طلب العميل (FR-31). تخزينه هنا آمن لأنه لا يحوي أي
    // سرّ ولا بيانات هوية فردية (فقط تعليمات ثابتة + إحصاءات مُجمَّعة).
    systemPromptSnapshot: { type: String, required: true },

    messages: { type: [encryptedMessageSchema], default: [] },

    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// جلسة واحدة مستمرة (محادثة متنامية) لكل (مستخدم، كورس) — إعادة فتح
// المساعد لنفس الكورس تُكمِل نفس السجل بدل تفريعه، وهذا هو المعروض في
// UC-AI-03 (سجل محادثاتي ضمن هذا الكورس).
aiConversationSchema.index({ userId: 1, courseId: 1 }, { unique: true });

applyReferentialIntegrity(aiConversationSchema, [
  { path: 'userId', ref: 'User', required: true },
  { path: 'courseId', ref: 'Course', required: true },
]);

module.exports = mongoose.model('AIConversation', aiConversationSchema);
