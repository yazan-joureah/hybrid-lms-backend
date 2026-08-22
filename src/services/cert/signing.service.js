// src/services/cert/signing.service.js
// SF-CERT-03 — Sign & Encrypt Certificate

const nodeCrypto = require('crypto');
const env = require('../../config/env');
const { encryptForUser } = require('../../utils/crypto');
const { toObjectId } = require('../../utils/objectId.util');
const { AppError } = require('../../middleware/errorHandler');

const CERT_ENCRYPTION_PURPOSE = 'certificate-key';

let cachedPrivateKey = null;
let cachedPublicKey = null;

// Lazily parses the PEM keys once per process instead of on every sign/
// verify call — createPrivateKey/createPublicKey do real parsing work,
// no reason to repeat it per certificate.
function getSigningKeys() {
  if (!cachedPrivateKey) {
    cachedPrivateKey = nodeCrypto.createPrivateKey(env.certSigning.privateKeyPem);
  }
  if (!cachedPublicKey) {
    cachedPublicKey = nodeCrypto.createPublicKey(env.certSigning.publicKeyPem);
  }
  return { privateKey: cachedPrivateKey, publicKey: cachedPublicKey };
}

// Builds the exact byte payload that gets signed. We sign the
//verification_hash rather than re-serializing all the
//certificate fields here
function buildSignaturePayload(verificationHash) {
  return Buffer.from(verificationHash, 'utf8');
}

//SF-CERT-03 — Sign & Encrypt Certificate
function signAndEncryptCertificate({ studentId, verificationHash, certificateData }) {
  if (!studentId || !verificationHash || !certificateData) {
    throw new AppError(
      400,
      'SIGNING_MISSING_FIELDS',
      'Missing required fields for certificate signing.'
    );
  }

  const safeStudentId = toObjectId(studentId, 'studentId');

  let signature;
  try {
    const { privateKey } = getSigningKeys();
    // Ed25519 signing — no digest algorithm argument (Node requires `null`
    // here specifically for Ed25519/Ed448, unlike ECDSA/RSA which need an
    // explicit hash like 'sha256'). Avoids CVE-2022-21449 (ECDSA nonce
    // reuse in Java) by construction — Ed25519 is deterministic and
    // doesn't depend on a per-signature random nonce at all.
    const rawSignature = nodeCrypto.sign(null, buildSignaturePayload(verificationHash), privateKey);
    signature = rawSignature.toString('base64');
  } catch (err) {
    //signing failure → cancel immediately,
    throw new AppError(500, 'CERTIFICATE_SIGNING_FAILED', 'Failed to sign certificate.');
  }

  let encryptedContent;
  try {
    const plaintextBuffer = Buffer.from(JSON.stringify(certificateData), 'utf8');
    encryptedContent = encryptForUser(plaintextBuffer, safeStudentId, CERT_ENCRYPTION_PURPOSE);
  } catch (err) {
    //encryption failure → retry once, then abort.
    throw new AppError(500, 'CERTIFICATE_ENCRYPTION_FAILED', 'Failed to encrypt certificate.');
  }

  return {
    signature,
    signingKeyVersion: env.certSigning.keyVersion,
    encryptedContent,
  };
}

// Used by UC-CERT-04 (Verify via QR) step 6: verifies the digital signature against the public key. Returns a boolean.
function verifyCertificateSignature({ verificationHash, signatureBase64 }) {
  if (!verificationHash || !signatureBase64) return false;

  try {
    const { publicKey } = getSigningKeys();
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    return nodeCrypto.verify(
      null,
      buildSignaturePayload(verificationHash),
      publicKey,
      signatureBuffer
    );
  } catch (err) {
    return false;
  }
}

module.exports = { signAndEncryptCertificate, verifyCertificateSignature };
