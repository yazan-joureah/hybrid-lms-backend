/* ==========================================================================
   src/models/peerSubmission.model.js
   مرحلة التسليم (غير مرقّمة UC صراحةً في التوثيق الأصلي، لكنها شرط مسبق
   ضروري لـ UC-PEER-02) + نتيجة UC-PEER-04 (الدرجة النهائية)
   ========================================================================== */

const mongoose = require('mongoose');

const peerSubmissionSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PeerAssignment',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    textContent: { type: String, trim: true, maxlength: 20000, default: null },
    fileId: { type: String, default: null }, // معرّف GridFS (fileStorage.service.js)
    storagePath: { type: String, default: null },
    submittedAt: { type: Date, required: true },

    // "عمل رقم N" — يُعيَّن فقط أثناء UC-PEER-02 (التوزيع)، يبقى null قبلها.
    // هذا هو الحقل الوحيد الذي يراه المراجِع — أبداً studentId مباشرة.
    displaySequentialId: { type: Number, default: null },

    // UC-PEER-04 — الدرجة النهائية بعد احتساب متوسط تقييمات المراجعين
    finalScore: { type: Number, default: null },
    finalScorePercentage: { type: Number, default: null },
    gradingFlagged: { type: Boolean, default: false }, // فارق مراجعين > 20% أو لا مراجع أكمل
    gradingFlagReason: { type: String, default: null },
  },
  { timestamps: true }
);

// تسليم واحد فقط لكل طالب لكل مهمة (إعادة التسليم = تحديث نفس السجل قبل الموعد)
peerSubmissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
peerSubmissionSchema.index({ assignmentId: 1, displaySequentialId: 1 });

module.exports = mongoose.model('PeerSubmission', peerSubmissionSchema);
