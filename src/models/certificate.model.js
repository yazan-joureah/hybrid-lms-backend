const mongoose = require('mongoose');
const crypto = require('crypto');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const certificateSchema = new mongoose.Schema(
  {
    certificate_id: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },

    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },

    student_name_snapshot: { type: String, required: true },
    course_title_snapshot: { type: String, required: true },

    issued_at: { type: Date, required: true, default: Date.now },

    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      required: true,
      index: true,
    },

    superseded_by: { type: String, default: null },

    qr_code_image: { type: Buffer, required: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'certificates',
  }
);

applyReferentialIntegrity(certificateSchema, [
  { path: 'student_id', ref: 'User', required: true },
  { path: 'course_id', ref: 'Course', required: true },
]);

module.exports = mongoose.model('Certificate', certificateSchema);
