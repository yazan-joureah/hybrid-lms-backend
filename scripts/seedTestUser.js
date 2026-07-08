/**
 * One-off, developer-invoked seeding script for Postman/manual testing.
 *
 * WHY THIS EXISTS: Login (both success and MFA-required paths) requires
 * an ACTIVE user with a KNOWN plaintext password. Our real registration
 * flow deliberately never returns that password back, and email
 * verification tokens are deliberately never exposed via any API response
 * (DP-08 — transient tokens exist only in the outbound email/console log).
 * That is correct production behavior, but it means Postman alone cannot
 * bootstrap a ready-to-login test account without either (a) a human
 * manually completing the email-verification round trip, or (b) a
 * developer-only seeding script like this one that talks to MongoDB
 * directly, bypassing the HTTP layer entirely.
 *
 * SAFETY GUARANTEES:
 *   - Refuses to run if NODE_ENV=production (hard stop, not a warning).
 *   - Never imported by src/app.js or src/server.js — it has no effect
 *     unless a developer runs it explicitly from the command line.
 *   - Idempotent (upsert): re-running it is always safe and produces the
 *     exact same two accounts, never duplicates.
 *
 * USAGE:
 *   node scripts/seedTestUser.js
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const MFAConfiguration = require('../src/models/MFAConfiguration');
const { hashPassword } = require('../src/utils/crypto');

const TEST_PASSWORD = 'Postman-Test-Passphrase-2026'; // 15+ chars, not on the NFR-02 blocklist

async function upsertUser({ email, mfaEnabled }) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        full_name: mfaEnabled ? 'Postman MFA Test User' : 'Postman Login Test User',
        email,
        password_hash: passwordHash,
        birth_date: new Date('1995-06-20'),
        role: 'Student',
        status: 'active',
        email_verified_at: new Date(),
        kyc_status: 'not_submitted',
        mfa_enabled: mfaEnabled,
        failed_login_count: 0,
        lock_until: null,
        privacy_consent: {
          policy_version: 'v1.0',
          accepted_at: new Date(),
          ip: '127.0.0.1',
          user_agent: 'seedTestUser.js',
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (mfaEnabled) {
    await MFAConfiguration.findOneAndUpdate(
      { user_id: user._id },
      { $set: { user_id: user._id, method: 'EMAIL', enabled: true, verified_at: new Date() } },
      { upsert: true }
    );
  }

  return user;
}

async function main() {
  if (env.nodeEnv === 'production') {
    // eslint-disable-next-line no-console -- intentional CLI-tool output
    console.error('Refusing to seed test users: NODE_ENV=production.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const plainUser = await upsertUser({ email: 'postman.login@example.com', mfaEnabled: false });
  const mfaUser = await upsertUser({ email: 'postman.mfa@example.com', mfaEnabled: true });

  // eslint-disable-next-line no-console -- intentional CLI-tool output
  console.log('Seeded test accounts for Postman (password for both: "%s"):', TEST_PASSWORD);
  // eslint-disable-next-line no-console
  console.log('  - No MFA  :', plainUser.email);
  // eslint-disable-next-line no-console
  console.log('  - With MFA:', mfaUser.email);

  await mongoose.connection.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
