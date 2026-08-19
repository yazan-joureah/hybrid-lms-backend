// src/services/cert/qrGeneration.service.js
// SF-CERT-02 — Create QR Code

const QRCode = require('qrcode');
const env = require('../../config/env');
const { sha256 } = require('../../utils/crypto');
const { AppError } = require('../../middleware/errorHandler');

/**
 * Builds the exact verification hash input in one place, so UC-CERT-04
 * (Verify) can recompute the IDENTICAL string later and compare — any
 * change to this format is a breaking change for every certificate
 * already issued, so field order/separators here must stay stable.
 */
function buildHashInput({ certificateId, studentNameSnapshot, courseTitleSnapshot, issuedAt }) {
  return [certificateId, studentNameSnapshot, courseTitleSnapshot, issuedAt.toISOString()].join(
    '|'
  );
}

// Generates the verification hash and a QR code image encoding:
// certificate ID + verification link + hash (per the literal UC text).
async function createCertificateQrCode({
  certificateId,
  studentNameSnapshot,
  courseTitleSnapshot,
  issuedAt,
}) {
  if (!certificateId || !studentNameSnapshot || !courseTitleSnapshot || !issuedAt) {
    throw new AppError(
      400,
      'QR_GENERATION_MISSING_FIELDS',
      'Missing required fields for QR code generation.'
    );
  }

  const verificationUrl = `${env.appUrl}/verify/${certificateId}`;

  const hashInput = buildHashInput({
    certificateId,
    studentNameSnapshot,
    courseTitleSnapshot,
    issuedAt,
  });
  const verificationHash = sha256(hashInput);

  const qrPayload = JSON.stringify({
    certificate_id: certificateId,
    verification_url: verificationUrl,
    hash: verificationHash,
  });

  let qrCodeImage;
  try {
    // PNG buffer
    qrCodeImage = await QRCode.toBuffer(qrPayload, {
      type: 'png',
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    throw new AppError(500, 'QR_IMAGE_GENERATION_FAILED', 'Failed to generate QR code image.');
  }

  return { qrCodeImage, verificationHash, verificationUrl };
}

//Recomputes the verification hash from CURRENT data for comparing
function recomputeVerificationHash({
  certificateId,
  studentNameSnapshot,
  courseTitleSnapshot,
  issuedAt,
}) {
  const hashInput = buildHashInput({
    certificateId,
    studentNameSnapshot,
    courseTitleSnapshot,
    issuedAt,
  });
  return sha256(hashInput);
}

module.exports = { createCertificateQrCode, recomputeVerificationHash };
