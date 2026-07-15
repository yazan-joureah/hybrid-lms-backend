// src/models/KYCDocument.js
//
// A separate entity from KYCRequest
// stores the actual encrypted documents, while KYCRequest (incoming file) stores
// the request state and points to these documents via file_reference only.
//

const mongoose = require('mongoose');
const crypto = require('crypto');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const kycDocumentSchema = new mongoose.Schema(
  {
    // UUID Opaque Token — the only identifier exposed to higher layers and
    // Audit Logs. We never expose the internal Mongo _id outside this file.
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
      index: true, // فهرس صريح — سيُستخدم في استعلامات المراجعة لاحقاً
    },
    document_type: {
      type: String,
      enum: ['national_id', 'passport', 'selfie'], // FR-43 (وثيقة رسمية) + FR-44 (Selfie)
      required: true,
    },
    // Fully encrypted data: [IV(12) | AuthTag(16) | Ciphertext] as raw Buffer
    encrypted_content: {
      type: Buffer,
      required: true,
    },
    // The actual type detected before encryption (for technical display during
    // review only, e.g., to show the correct image icon — not sensitive itself)
    detected_mime_type: {
      type: String,
      required: true,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } } // snake_case حسب المعيار
);

applyReferentialIntegrity(kycDocumentSchema, [{ path: 'user_id', ref: 'User', required: true }]);

module.exports = mongoose.model('KYCDocument', kycDocumentSchema);
