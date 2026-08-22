// tests/helpers/setupCertSigningKeys.js
//
// Side-effect-only module: generates a throwaway Ed25519 key pair for the
// test run and injects it into process.env BEFORE any test file requires
// env.js (which fails fast via required() if these are missing — same
// fail-fast discipline already applied project-wide). Required once per
// test file via a plain `require(...)` at the very top, before any other
// src/ import — avoids duplicating this generation logic across every
// CERT test file.
//
// IMPORTANT: this ALWAYS overrides CERT_SIGNING_* env vars, even if they
// are already set (by a local .env file, or by CI generating its own
// keypair for the app to boot — see ci.yml). Test assertions across this
// suite hardcode 'test-v1' as the expected signingKeyVersion, so the test
// environment must be self-contained and deterministic regardless of
// whatever the surrounding process/CI environment happens to provide.
// Without this override, tests would pass or fail depending on whether an
// external CERT_SIGNING_PRIVATE_KEY_PEM happened to be present — exactly
// the flakiness that broke this suite once ci.yml started generating its
// own keypair.

const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
process.env.CERT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.CERT_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' });
process.env.CERT_SIGNING_KEY_VERSION = 'test-v1';
