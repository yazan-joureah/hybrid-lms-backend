// src/models/KYCRequest.js

const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const { Schema } = mongoose;

const kycRequestSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    applicant_role: {
      type: String,
      enum: ['Student', 'Instructor'],
      required: true,
    },

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
      index: true,
    },

    reviewed_by_admin_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    review_decision_reason: {
      type: String,
      default: null,
    },
    age_discrepancy_years: {
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

kycRequestSchema.index({ user_id: 1, status: 1 });

applyReferentialIntegrity(kycRequestSchema, [
  { path: 'user_id', ref: 'User', required: true },
  { path: 'reviewed_by_admin_id', ref: 'User', required: false },
]);

module.exports = mongoose.model('KYCRequest', kycRequestSchema);
