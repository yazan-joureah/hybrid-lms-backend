// src/services/cert/credential.service.js
// Single source of truth for certificate credentials: builds and signs
// Open Badges 3.0 / W3C Verifiable Credentials as VC-JWT (EdDSA/Ed25519),
// verifies them, and generates the verification QR code.
//
// Ed25519 (via JWT's "EdDSA" alg) is used deliberately instead of
// ECDSA/RSA: EdDSA signatures are deterministic (no per-signature random
// nonce), which avoids nonce-reuse class vulnerabilities entirely by
// construction (unlike e.g. CVE-2022-21449 in ECDSA implementations).

const { SignJWT, jwtVerify } = require('jose');
const { createPrivateKey, createPublicKey } = require('crypto');
const QRCode = require('qrcode');
const env = require('../../config/env');
const { AppError } = require('../../middleware/errorHandler');

const OB3_CONTEXTS = [
  'https://www.w3.org/ns/credentials/v2',
  'https://purl.imsglobal.org/spec/ob/v3p0/context.json',
];

function buildIssuer() {
  return {
    id: env.openBadges.issuerId,
    type: 'Profile',
    name: env.openBadges.issuerName,
    url: env.appUrl,
    ...(env.openBadges.issuerLogoUrl
      ? { image: { id: env.openBadges.issuerLogoUrl, type: 'Image' } }
      : {}),
  };
}

function buildSubjectId(studentId) {
  return `urn:hybridlms:student:${studentId.toString()}`;
}

/**
 * Builds the Open Badges 3.0 credential JSON for a certificate document.
 * Pure function — no DB access here, caller passes in already-fetched data.
 */
function buildCredential({ certificate, criteriaNarrative, courseDescription }) {
  const credentialId = `urn:uuid:${certificate.certificate_id}`;
  const achievementId = `${env.appUrl}/achievements/${certificate.course_id.toString()}`;
  const subjectId = buildSubjectId(certificate.student_id);

  const credential = {
    '@context': OB3_CONTEXTS,
    id: credentialId,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: buildIssuer(),
    validFrom: new Date(certificate.issued_at).toISOString(),
    name: `${certificate.course_title_snapshot} — Certificate of Completion`,
    credentialSubject: {
      id: subjectId,
      type: 'AchievementSubject',
      name: certificate.student_name_snapshot,
      achievement: {
        id: achievementId,
        type: 'Achievement',
        name: certificate.course_title_snapshot,
        description: courseDescription || certificate.course_title_snapshot,
        criteria: {
          narrative:
            criteriaNarrative ||
            'Successfully completed all required course modules, passed the final assessment with a score of 70% or higher, and met the minimum attendance requirement for scheduled live sessions where applicable.',
        },
      },
    },
  };

  if (certificate.status === 'revoked') {
    credential.validUntil = new Date(certificate.updated_at || certificate.issued_at).toISOString();
  }

  return { credential, credentialId, subjectId };
}

/**
 * Signs a built credential as a VC-JWT (EdDSA/Ed25519) using jose.
 * Returns the JWT string.
 */
async function signCredential({ credential, credentialId, subjectId }) {
  const privateKeyPem = env.certSigning.privateKeyPem;
  if (
    !privateKeyPem ||
    typeof privateKeyPem !== 'string' ||
    !privateKeyPem.includes('BEGIN PRIVATE KEY')
  ) {
    throw new AppError(
      500,
      'INVALID_PRIVATE_KEY',
      'Certificate signing private key is missing or invalid.'
    );
  }

  try {
    const privateKey = createPrivateKey(privateKeyPem);
    const jwt = await new SignJWT({ vc: credential })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(env.openBadges.issuerId)
      .setSubject(subjectId)
      .setJti(credentialId)
      .sign(privateKey);
    return jwt;
  } catch (err) {
    console.error('JWT signing error (jose):', err.message);
    throw new AppError(
      500,
      'CREDENTIAL_SIGNING_FAILED',
      `Failed to sign certificate credential: ${err.message}`
    );
  }
}

/**
 * Verifies a VC-JWT's signature + standard claims (iss/exp/nbf) using the
 * Ed25519 public key. Returns the decoded payload on success, or null if
 * the token is invalid, expired, or tampered with.
 */
async function verifyCredentialJwt(token) {
  const publicKeyPem = env.certSigning.publicKeyPem;
  if (!publicKeyPem) return null;

  try {
    const publicKey = createPublicKey(publicKeyPem);
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['EdDSA'],
      issuer: env.openBadges.issuerId,
    });
    return payload;
  } catch {
    return null;
  }
}

/**
 * Convenience: build + sign in one call — the normal issue/verify path.
 * Now async because signing is async.
 */
async function issueCredentialJwt({ certificate, criteriaNarrative, courseDescription }) {
  const built = buildCredential({ certificate, criteriaNarrative, courseDescription });
  const token = await signCredential(built);
  return { token, credential: built.credential };
}

/**
 * Generates the QR code image for a certificate. The QR encodes the
 * PUBLIC verification URL, not the JWT itself — this keeps the QR small
 * and reliably scannable, and means revocation/re-issuance never requires
 * regenerating the QR image, since the URL always resolves to whatever
 * the certificate's CURRENT status is at scan time.
 */
async function generateCertificateQrCode(certificateId) {
  // ✅ لازم يشاور على صفحة الفرونت (اللي فيها عرض بصري للطرف الثالث)،
  // مو مباشرة على الـ API endpoint (اللي بيرجع JSON خام).
  const verificationUrl = `${env.frontUrl}/verify/${certificateId}`;
  try {
    const qrCodeImage = await QRCode.toBuffer(verificationUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
    });
    return { qrCodeImage, verificationUrl };
  } catch (err) {
    throw new AppError(500, 'QR_IMAGE_GENERATION_FAILED', 'Failed to generate QR code image.');
  }
}

function getIssuerProfile() {
  return { '@context': OB3_CONTEXTS, ...buildIssuer() };
}

module.exports = {
  buildCredential,
  signCredential,
  verifyCredentialJwt,
  issueCredentialJwt,
  generateCertificateQrCode,
  getIssuerProfile,
};
