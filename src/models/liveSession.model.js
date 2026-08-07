/* ==========================================================================
   src/models/liveSession.model.js
   يغطي: UC-LIVE-01 (Create/Schedule) .. UC-LIVE-08 (End & Recording)
   ========================================================================== */

const mongoose = require('mongoose');

const liveSessionSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    meetingLink: {
      type: String,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },

    // UC-LIVE-02 / UC-LIVE-08 — دورة حياة الجلسة
    // scheduled: مجدولة ولم تبدأ | ongoing: بدأت فعلياً (endSession لم يُستدعَ بعد)
    // ended: أُنهيت من المحاضر | cancelled: أُلغيت قبل انعقادها
    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'ended', 'cancelled'],
      required: true,
      default: 'scheduled',
    },
    cancelReason: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },

    // UC-LIVE-05 — التحكم في غرفة الانتظار
    // false (افتراضي): انضمام مباشر فور نجاح SF-LIVE-01
    // true: الطالب يدخل بحالة "انتظار" حتى يقبله المحاضر صراحةً
    lobbyEnabled: {
      type: Boolean,
      default: false,
    },

    // UC-LIVE-07 — التحكم بالصلاحيات والأداء (الحالة اللحظية الحالية للجلسة)
    mutedParticipantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    allMuted: {
      type: Boolean,
      default: false,
    },
    screenShareByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    removedParticipantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // UC-LIVE-08 — إنهاء البث وحفظ التسجيل
    recordingStatus: {
      type: String,
      enum: ['none', 'processing', 'ready', 'failed'],
      default: 'none',
    },
    recordingUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

liveSessionSchema.index({ courseId: 1, startTime: 1 });
liveSessionSchema.index({ instructorId: 1, startTime: 1 });
liveSessionSchema.index({ status: 1, startTime: 1 });

module.exports = mongoose.model('LiveSession', liveSessionSchema);
