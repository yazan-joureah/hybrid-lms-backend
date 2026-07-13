// src/models/KYCRequest.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

const kycRequestSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // Used to check "there is no previous review_pending request" (UC-KYC-01, Precondition 5)
    },

    // The role at the time of submission — Student or Instructor. Explicitly defined here
    // (rather than derived from User upon reading later) because granting Instructor
    // privileges in SF-KYC-01 depends specifically on this value at the time of review,
    // and the user's role may change later for other reasons — the field here freezes
    // the context at the time of request.
    applicant_role: {
      type: String,
      enum: ['Student', 'Instructor'],
      required: true,
    },

    // Two references to KYCDocument.file_reference — not embedding nor direct
    // ObjectId, in line with the principle of not exposing internal _id even
    // between entities themselves.
    id_document_reference: {
      type: String,
      required: true,
    },
    selfie_reference: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['review_pending', 'verified', 'rejected', 'age_flagged'],
      default: 'review_pending',
      required: true,
      index: true, // يُستخدم في استعلام "قائمة الطلبات المعلَّقة" (UC-KYC-02 خطوة 2)
    },

    // === حقول تُملأ فقط أثناء/بعد المراجعة (UC-KYC-02) — null عند التقديم ===

    reviewed_by_admin_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    review_decision_reason: {
      // Logically mandatory only when rejected (list of reasons classified per UC-KYC-02,
      // b7), optional when verified. We do not enforce 'required' at the Schema level
      // because the requirement is conditional on the status — enforced in
      // kycReview.service.js instead (conditional logic not well-expressed by static Mongoose constraints).
      type: String,
      default: null,
    },
    age_discrepancy_years: {
      // Calculated only at the time of review (see note above) — can be zero or a
      // decimal number (difference in months converted to a fraction of a year if needed).
      type: Number,
      default: null,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'submitted_at', updatedAt: 'updated_at' },
    collection: 'kyc_requests',
  }
);

// Compound index: Prevents slow lookups when checking "is there a previous
// review_pending request for the same user?" — a mandatory check for every submission
// (UC-KYC-01, Precondition 5)
kycRequestSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model('KYCRequest', kycRequestSchema);
