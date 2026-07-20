// scripts/seedDevUsers.js
/**
 * Seeds one fully-privileged user per role for local frontend/backend
 * development (Student, Instructor with verified KYC+MFA, Admin, SuperAdmin
 * with verified MFA). NEVER run against production — guarded below.
 *
 * Usage: node scripts/seedDevUsers.js
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('seedDevUsers.js must never run with NODE_ENV=production.');
}

const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const MFAConfiguration = require('../src/models/MFAConfiguration');
const { hashPassword } = require('../src/utils/crypto');
const { generateEncryptedTotpSecret } = require('../src/utils/totp');

const DEV_PASSWORD = 'a-genuinely-long-passphrase-2026'; // dev/test only — same value used across the test suite

const USERS_TO_SEED = [
  {
    key: 'student',
    full_name: 'Dev Student',
    email: 'student@dev.local',
    role: 'Student',
    needsMfa: false,
  },
  {
    key: 'instructor',
    full_name: 'Dev Instructor',
    email: 'instructor@dev.local',
    role: 'Instructor',
    needsMfa: true,
  },
  { key: 'admin', full_name: 'Dev Admin', email: 'admin@dev.local', role: 'Admin', needsMfa: true },
  {
    key: 'superadmin',
    full_name: 'Dev SuperAdmin',
    email: 'superadmin@dev.local',
    role: 'SuperAdmin',
    needsMfa: true,
  },
];

/** Creates a User doc with full privileges for its role, plus a real TOTP secret if needed. */
async function seedOneUser(spec) {
  const existing = await User.findOne({ email: spec.email });
  if (existing) {
    console.log(`  ${spec.email} already exists — skipping`);
    return null;
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const user = await User.create({
    full_name: spec.full_name,
    email: spec.email,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: spec.role,
    status: 'active',
    email_verified_at: new Date(),
    kyc_status: spec.role === 'Instructor' ? 'verified' : 'not_submitted',
    mfa_enabled: spec.needsMfa, // set true directly here — dev-only convenience, real TOTP secret follows below
    privacy_consent: {
      policy_version: env.privacyPolicyVersion,
      accepted_at: new Date(),
      ip: 'seed-script',
      user_agent: 'seed-script',
    },
  });

  let rawSecret = null;
  if (spec.needsMfa) {
    const { rawSecret: secret, encryptedSecret } = generateEncryptedTotpSecret();
    rawSecret = secret;
    await MFAConfiguration.create({
      user_id: user._id,
      method: 'TOTP',
      secret_encrypted: encryptedSecret,
      enabled: true,
      verified_at: new Date(),
    });
  }

  return { ...spec, id: user._id.toString(), rawSecret };
}

async function run() {
  await mongoose.connect(env.mongoUri);
  logger.info('Connected to database for dev user seeding');

  const results = [];
  for (const spec of USERS_TO_SEED) {
    // eslint-disable-next-line no-await-in-loop -- sequential seeding, negligible one-time cost
    const result = await seedOneUser(spec);
    if (result) results.push(result);
  }

  console.log('\n=== DEV SEED SUMMARY (all use the same password) ===');
  console.log(`Password for all: ${DEV_PASSWORD}\n`);
  results.forEach((r) => {
    console.log(`[${r.role}] ${r.email}`);
    if (r.rawSecret) {
      console.log(`  TOTP manual entry key: ${r.rawSecret}`);
      console.log(
        '  (scan/enter this into any authenticator app, e.g. via generateTotpCode() in a quick script)'
      );
    }
    console.log('');
  });

  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Dev seed failed', { error: err.message });
  console.error(err);
  process.exit(1);
});
