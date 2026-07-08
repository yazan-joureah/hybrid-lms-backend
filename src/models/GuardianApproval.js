/**
 * E08 — GuardianApproval
 * Source: Module_DB_Design_Specification_v1.3, Section 4.
 *
 * Two independent token pairs are issued in parallel at creation time:
 *  - approval_token_hash        → sent to the guardian's email
 *  - student_access_token_hash  → sent to the student, allowing them to
 *    resend/edit the guardian email WITHOUT a JWT session (the account is
 *    not `active` yet, so no session can exist — this closes the circular
 *    dead-end identified during the Register/Guardian logic review).
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const guardianApprovalSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    guardian_email: { type: String, required: true, lowercase: true, trim: true },

    approval_token_hash: { type: String, required: true },
    student_access_token_hash: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      required: true,
      default: 'pending',
    },
    resend_count: { type: Number, required: true, default: 0 },

    expires_at: { type: Date, required: true },
    approved_at: { type: Date, default: null },
    rejected_at: { type: Date, default: null },

    guardian_ip: { type: String, default: null },
    guardian_device_fingerprint: { type: String, default: null },
    guardian_user_agent: { type: String, default: null },

    student_registration_ip: { type: String, required: true },
    student_device_fingerprint: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'guardian_approvals',
  }
);

guardianApprovalSchema.index({ user_id: 1 });
guardianApprovalSchema.index({ status: 1 });
guardianApprovalSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL
guardianApprovalSchema.index({ student_registration_ip: 1 }); // MUC-AUTH-09

module.exports = mongoose.model('GuardianApproval', guardianApprovalSchema);
