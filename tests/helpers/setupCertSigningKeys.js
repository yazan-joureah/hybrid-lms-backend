// tests/helpers/setupCertSigningKeys.js
//
// Side-effect-only module: generates a throwaway Ed25519 key pair for the
// test run and injects it into process.env BEFORE any test file requires
// env.js (which fails fast via required() if these are missing — same
// fail-fast discipline already applied project-wide). Required once per
// test file via a plain `require(...)` at the very top, before any other
// src/ import — avoids duplicating this generation logic across every
// CERT test file.

const crypto = require('crypto');

if (!process.env.CERT_SIGNING_PRIVATE_KEY_PEM) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.CERT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.CERT_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' });
  process.env.CERT_SIGNING_KEY_VERSION = 'test-v1';
}
