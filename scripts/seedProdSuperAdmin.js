// scripts/seedProdSuperAdmin.js
/**
 * One-time bootstrap: creates the platform's first SuperAdmin account.
 * Idempotent — refuses to run if the account already exists (never
 * overwrites a live account on re-run). Safe to run against production.
 *
 * SECURITY: MFA is intentionally NOT enabled here — no TOTP secret is
 * generated or printed. The SuperAdmin enables MFA themselves on first
 * login via the existing, already-tested endpoints (POST /auth/mfa/totp/setup
 * then /verify), exactly like any other user. Sharing a pre-generated TOTP
 * secret out-of-band would be a real exposure risk for the highest-privilege
 * account in the system — reusing the real device-scan flow avoids that.
 *
 * Usage:
 *   SEED_SUPERADMIN_EMAIL=admin@yourdomain.com \
 *   SEED_SUPERADMIN_PASSWORD='a-genuinely-long-passphrase-2026' \
 *   node scripts/seedProdSuperAdmin.js
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const { hashPassword } = require('../src/utils/crypto');
const { isBlocklisted } = require('../src/validators/authSchemas');
const auditService = require('../src/services/auditService');

const MIN_PASSWORD_LENGTH = 15; // NIST SP 800-63-4 — same policy as authSchemas.js

async function run() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD are required.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || isBlocklisted(password)) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} chars and not a common password.`
    );
  }

  await mongoose.connect(env.mongoUri);
  logger.info('Connected to database for SuperAdmin bootstrap');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    logger.info('SuperAdmin already exists — no changes made', { email });
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);

  const superAdmin = await User.create({
    full_name: 'Platform Super Admin',
    email: email.toLowerCase(),
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'), // DEVIATION: placeholder — not a real applicant, no age-gating applies
    role: 'SuperAdmin',
    status: 'active',
    email_verified_at: new Date(), // DEVIATION: bootstrap account skips email verification by design
    kyc_status: 'not_submitted', // SuperAdmin never needs KYC — not an Instructor
    mfa_enabled: false, // enabled by the SuperAdmin themselves on first login
    privacy_consent: {
      policy_version: env.privacyPolicyVersion,
      accepted_at: new Date(),
      ip: 'seed-script',
      user_agent: 'seed-script',
    },
  });

  await auditService.record({
    actorId: superAdmin._id,
    actorRole: 'SuperAdmin',
    action: 'SUPERADMIN_BOOTSTRAP_SEEDED',
    resourceType: 'User',
    resourceId: superAdmin._id.toString(),
    req: null,
  });

  logger.info('SuperAdmin created successfully', { email, id: superAdmin._id.toString() });
  console.log(`\n✅ SuperAdmin created: ${email}`);
  console.log(
    '⚠️  MFA is NOT enabled yet — log in and complete /auth/mfa/totp/setup immediately.\n'
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('SuperAdmin bootstrap failed', { error: err.message });
  console.error(err);
  process.exit(1);
});
