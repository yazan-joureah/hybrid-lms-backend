// src/config/uploadPolicies.js

const IMAGE_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  maxFileSizeBytes: 5 * 1024 * 1024,
});

const KYC_DOCUMENT_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze(['image/png', 'image/jpeg']),
  maxFileSizeBytes: 5 * 1024 * 1024,
});

const COURSE_CONTENT_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze(['video/mp4', 'application/pdf']),
  maxFileSizeBytes: 50 * 1024 * 1024,
});

const PEER_SUBMISSION_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze([
    'application/pdf',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
  maxFileSizeBytes: 50 * 1024 * 1024,
});

module.exports = {
  IMAGE_POLICY,
  KYC_DOCUMENT_POLICY,
  COURSE_CONTENT_POLICY,
  PEER_SUBMISSION_POLICY,
};
