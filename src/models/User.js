const mongoose = require('mongoose');
const { Schema } = mongoose;

const PERMISSIONS = [
  'MANAGE_STUDENT_ACCOUNTS',
  'MANAGE_INSTRUCTOR_ACCOUNTS',
  'DELETE_ACCOUNTS',
  'REVIEW_KYC',
  'REVIEW_COURSES',
  'VIEW_PLATFORM_ANALYTICS',
  'MANAGE_REFUNDS',
  'CREATE_ADMIN',
  'DELETE_ADMIN',
  'MANAGE_PAYMENT_SETTINGS',
  'MANAGE_CERT_TEMPLATES',
];

const privacyConsentSchema = new Schema(
  {
    policy_version: { type: String, required: true },
    accepted_at: { type: Date, required: true },
    ip: { type: String, required: true },
    user_agent: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    full_name: { type: String, default: null },
    email: { type: String, default: null, lowercase: true, trim: true },
    password_hash: { type: String, default: null },
    birth_date: { type: Date, default: null },
    phone: { type: String, default: null, trim: true },
    bio: { type: String, default: null, trim: true, maxlength: 500 },
    role: {
      type: String,
      enum: ['Student', 'Instructor', 'Admin', 'SuperAdmin'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending_email_verification',
        'guardian_pending',
        'active',
        'temporary_locked',
        'suspended',
        'deleted',
      ],
      required: true,
      default: 'pending_email_verification',
    },

    email_verified_at: { type: Date, default: null },
    profile_picture_storage_path: { type: String, default: null },
    kyc_status: {
      type: String,
      enum: ['not_submitted', 'review_pending', 'verified', 'rejected', 'age_flagged'],
      required: true,
      default: 'not_submitted',
    },
    mfa_enabled: { type: Boolean, required: true, default: false },
    token_version: { type: Number, required: true, default: 1 },
    failed_login_count: { type: Number, required: true, default: 0 },
    lock_until: { type: Date, default: null },

    deleted_at: { type: Date, default: null },
    anonymized_at: { type: Date, default: null },

    permissions: { type: [String], enum: PERMISSIONS, default: [] },

    privacy_consent: { type: privacyConsentSchema, default: null },
    terms_accepted_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ deleted_at: 1 });
userSchema.index({ deleted_at: 1, anonymized_at: 1 });

module.exports = mongoose.model('User', userSchema);
module.exports.PERMISSIONS = PERMISSIONS;
