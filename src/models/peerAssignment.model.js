/* ==========================================================================
   src/models/peerAssignment.model.js
   UC-PEER-01 — Create Peer Assessment Task
   ========================================================================== */

const mongoose = require('mongoose');

// كل محور تقييم في الـ Rubric — اسم المحور، أقصى درجة له، ووزنه في الدرجة الكلية
const rubricCriterionSchema = new mongoose.Schema(
  {
    criterion: { type: String, required: true, trim: true, maxlength: 200 },
    maxScore: { type: Number, required: true, min: 1 },
    weight: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const peerAssignmentSchema = new mongoose.Schema(
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
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    rubric: {
      type: [rubricCriterionSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'يجب إضافة محور تقييم واحد على الأقل.',
      },
    },
    submissionDeadline: { type: Date, required: true },
    reviewDeadline: { type: Date, required: true },
    // عدد المراجعين لكل تسليم — افتراضي 2 حسب UC-PEER-01 خطوة 5
    reviewersPerSubmission: { type: Number, required: true, default: 2, min: 1 },

    // open: يقبل تسليمات الطلاب | distributed: وُزِّعت المراجعات (UC-PEER-02 اكتملت)
    // completed: احتُسبت الدرجات النهائية (UC-PEER-04 اكتملت)
    status: {
      type: String,
      enum: ['open', 'distributed', 'completed'],
      default: 'open',
    },
    distributedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

peerAssignmentSchema.index({ courseId: 1, submissionDeadline: 1 });
peerAssignmentSchema.index({ status: 1, submissionDeadline: 1 });
peerAssignmentSchema.index({ status: 1, reviewDeadline: 1 });

module.exports = mongoose.model('PeerAssignment', peerAssignmentSchema);
