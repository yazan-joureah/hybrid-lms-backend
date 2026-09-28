const mongoose = require('mongoose');
const crypto = require('crypto');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const kycDocumentSchema = new mongoose.Schema(
  {
    file_reference: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    document_type: {
      type: String,
      enum: ['national_id', 'passport', 'selfie'],
      required: true,
    },
    encrypted_content: {
      type: Buffer,
      required: true,
    },
    detected_mime_type: {
      type: String,
      required: true,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

applyReferentialIntegrity(kycDocumentSchema, [{ path: 'user_id', ref: 'User', required: true }]);

module.exports = mongoose.model('KYCDocument', kycDocumentSchema);
