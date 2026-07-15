/**
 * One-off, developer-invoked seeding script for Postman/manual testing of admin endpoints.
 *
 * WHY THIS EXISTS: Admin login requires an ACTIVE user with ADMIN role and known password,
 * same as seedTestUser.js for regular users. This script seeds a dedicated admin account
 * so that Postman collections can test admin-protected routes.
 *
 * SAFETY GUARANTEES:
 *   - Refuses to run if NODE_ENV=production (hard stop, not a warning).
 *   - Never imported by src/app.js or src/server.js — it has no effect
 *     unless a developer runs it explicitly from the command line.
 *   - Idempotent (upsert): re-running it is always safe and produces the
 *     exact same account, never duplicates.
 *
 * USAGE:
 *   node scripts/seedAdminForPostman.js
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const { hashPassword } = require('../src/utils/crypto');

const TEST_PASSWORD = 'Postman-Test-Passphrase-2026'; // same as seedTestUser.js

// Define a set of admin permissions (adjust as needed for your admin routes)
const ADMIN_PERMISSIONS = [
  'MANAGE_STUDENT_ACCOUNTS',
  'MANAGE_INSTRUCTOR_ACCOUNTS',
  'DELETE_ACCOUNTS',
  'REVIEW_KYC',
  'REVIEW_COURSES',
  'VIEW_PLATFORM_ANALYTICS',
  'MANAGE_REFUNDS',
  'CREATE_ADMIN',
  'DELETE_ADMIN',
  'MANAGE_PAYMENT_SETTINGS',
  'MANAGE_CERT_TEMPLATES',
];

async function upsertAdmin({ email, role = 'Admin', permissions = ADMIN_PERMISSIONS }) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        full_name: 'Postman Admin Test User',
        email,
        password_hash: passwordHash,
        birth_date: new Date('1980-01-01'),
        role: role,
        status: 'active',
        email_verified_at: new Date(),
        kyc_status: 'verified', // Admins don't need KYC, but set to verified to avoid issues
        mfa_enabled: false,
        failed_login_count: 0,
        lock_until: null,
        privacy_consent: {
          policy_version: 'v1.0',
          accepted_at: new Date(),
          ip: '127.0.0.1',
          user_agent: 'seedAdminForPostman.js',
        },
        permissions: permissions,
        terms_accepted_at: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return user;
}

async function main() {
  if (env.nodeEnv === 'production') {
    // eslint-disable-next-line no-console -- intentional CLI-tool output
    console.error('Refusing to seed admin user: NODE_ENV=production.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  // Seed a regular Admin
  const adminUser = await upsertAdmin({ email: 'postman.admin@example.com', role: 'Admin' });

  // Optionally seed a SuperAdmin (uncomment if needed)
  // const superAdminUser = await upsertAdmin({ email: 'postman.superadmin@example.com', role: 'SuperAdmin' });

  // eslint-disable-next-line no-console -- intentional CLI-tool output
  console.log('Seeded admin account for Postman (password: "%s"):', TEST_PASSWORD);
  // eslint-disable-next-line no-console
  console.log('  - Admin      :', adminUser.email);
  // console.log('  - SuperAdmin :', superAdminUser.email); // uncomment if used

  await mongoose.connection.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
