const mongoose = require('mongoose');

/**
 * ATT — سجل الحضور (هيكل أولي Preliminary Skeleton)
 * يُنشَأ تلقائياً بواسطة UC-ATT-04 عند انضمام الطالب فعلياً عبر UC-LIVE-01.
 *
 * DEVIATION: هذا نموذج مبدئي فقط لدعم UC-LIVE-01 (الذي يتضمن UC-ATT-04).
 * منطق الإنهاء الكامل (partial/absent حسب مدة الاتصال، مطابقة CSV عبر SF-ATT-02،
 * كود الحضور عبر SF-ATT-01) يُضاف لاحقاً عند بناء وحدة ATT بالكامل بعد اكتمال LIVE.
 */
const attendanceSchema = new mongoose.Schema(
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
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    joinedAt: {
      type: Date,
      required: true,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    // preliminary: أُنشئ عند الانضمام فقط ولم يُحسم بعد بناءً على مدة الاتصال (خطوة 4 في UC-ATT-04)
    // present / partial / absent: قيم نهائية تُحدَّد لاحقاً بمنطق وحدة ATT الكامل
    status: {
      type: String,
      enum: ['preliminary', 'present', 'partial', 'absent'],
      default: 'preliminary',
    },
    source: {
      type: String,
      enum: ['auto_join', 'code', 'csv_import', 'manual'],
      default: 'auto_join',
    },
  },
  { timestamps: true }
);

// Idempotent by design: سجل حضور واحد فقط لكل طالب لكل جلسة (يمنع التكرار عند إعادة محاولة الانضمام)
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
