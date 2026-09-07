// scripts/seedDemoUsers.js
/**
 * DEVIATION: One-time, EXPLICITLY-OPT-IN seeding script for the live
 * academic demo deployment (Render). This is NOT seedDevUsers.js — that
 * script's NODE_ENV guard must remain untouched. This script exists
 * because graders/reviewers need one working account per role on the
 * public URL, without weakening the production guard used everywhere else.
 *
 * SECURITY — why this is safer than just relaxing seedDevUsers.js:
 *   1. Requires an explicit, non-guessable confirmation env var in
 *      addition to NODE_ENV=production — a copy-pasted `node script.js`
 *      in the wrong terminal will NOT silently create accounts.
 *   2. The shared password is NOT hardcoded — it comes from env, so it
 *      never lives in git history (the repo is public for CodeQL/Secret
 *      Scanning per project policy).
 *   3. Raw TOTP secrets are printed to STDOUT only (meant to be run via
 *      Render's one-off "Shell" tab, not as a Start Command), never
 *      passed to `logger.*` — the structured logger may forward to
 *      persistent log storage; console.log in an interactive shell does not.
 *   4. Every created account is audit-logged with actor_role: 'System'
 *      (this was an automated bootstrap event, not an authenticated
 *      user action — same distinction already applied to
 *      seedProdSuperAdmin.js).
 *
 * RESIDUAL RISK (documented, accepted for academic demo only):
 *   These accounts remain fully privileged, predictable-email, shared-
 *   password accounts on a public URL for as long as they exist. This is
 *   acceptable ONLY because: (a) no real user data or payment data is at
 *   stake — Stripe is in Test Mode exclusively per project policy, and
 *   (b) the mitigation in step "Post-Demo Cleanup" below is followed.
 *   This is NOT an acceptable pattern for any real production system.
 *
 * Usage (run ONCE, ideally via Render's Shell tab, not a persisted script):
 *   ALLOW_PROD_DEMO_SEED=yes-i-understand-the-risk \
 *   SEED_DEMO_PASSWORD='<a long, one-off passphrase, NOT committed anywhere>' \
 *   node scripts/seedDemoUsers.js
 *
 * Post-Demo Cleanup (do this after grading/presentation is over):
 *   - Change SEED_DEMO_PASSWORD-derived hashes by re-running this script's
 *     sibling deletion, OR manually set these 4 accounts' status to
 *     'suspended' via UC-AUTH-08 (08.1/08.2), OR delete them via UC-AUTH-08
 *     (08.4/08.5) once no longer needed.
 */

if (process.env.NODE_ENV !== 'production') {
  throw new Error(
    'seedDemoUsers.js targets the live demo deployment only. Use seedDevUsers.js locally instead.'
  );
}

// Second, independent gate — NODE_ENV=production alone is NOT sufficient
// to run this script. This prevents any CI step, deploy hook, or Start
// Command from ever triggering it unintentionally.
const CONFIRMATION_PHRASE = 'yes-i-understand-the-risk';
if (process.env.ALLOW_PROD_DEMO_SEED !== CONFIRMATION_PHRASE) {
  throw new Error(
    `Refusing to run: set ALLOW_PROD_DEMO_SEED=${CONFIRMATION_PHRASE} explicitly to confirm.`
  );
}

const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const MFAConfiguration = require('../src/models/MFAConfiguration');
const { hashPassword } = require('../src/utils/crypto');
const { generateEncryptedTotpSecret } = require('../src/utils/totp');
const { isBlocklisted, MIN_PASSWORD_LENGTH } = require('../src/validators/authSchemas');
const auditService = require('../src/services/auditService');

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

const USERS_TO_SEED = [
  {
    key: 'student',
    full_name: 'Demo Student',
    email: 'demo-student@hybrid-lms.test',
    role: 'Student',
    needsMfa: false,
  },
  {
    key: 'instructor',
    full_name: 'Demo Instructor',
    email: 'demo-instructor@hybrid-lms.test',
    role: 'Instructor',
    needsMfa: true,
  },
  {
    key: 'admin',
    full_name: 'Demo Admin',
    email: 'demo-admin@hybrid-lms.test',
    role: 'Admin',
    needsMfa: true,
  },
  {
    key: 'superadmin',
    full_name: 'Demo SuperAdmin',
    email: 'demo-superadmin@hybrid-lms.test',
    role: 'SuperAdmin',
    needsMfa: true,
  },
];

/** Creates one demo User with full role privileges, plus a real TOTP secret if needed. */
async function seedOneUser(spec) {
  const existing = await User.findOne({ email: spec.email });
  if (existing) {
    // eslint-disable-next-line no-console -- CLI seed script, this IS the user-facing output
    console.log(`  ${spec.email} already exists — skipping`);
    return null;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await User.create({
    full_name: spec.full_name,
    email: spec.email,
    password_hash: passwordHash,
    birth_date: null, // not a real applicant — no age-gating applies, no placeholder needed
    role: spec.role,
    status: 'active',
    email_verified_at: new Date(),
    kyc_status: spec.role === 'Instructor' ? 'verified' : 'not_submitted',
    mfa_enabled: spec.needsMfa,
    privacy_consent: {
      policy_version: env.privacyPolicyVersion,
      accepted_at: new Date(),
      ip: 'seed-script',
      user_agent: 'seed-script',
    },
  });

  await auditService.record({
    actorId: user._id,
    actorRole: 'System', // automated bootstrap event, not an authenticated session action
    action: 'DEMO_ACCOUNT_SEEDED',
    resourceType: 'User',
    resourceId: user._id.toString(),
    metadata: { role: spec.role, purpose: 'academic_demo' },
    req: null,
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
  if (!DEMO_PASSWORD) {
    throw new Error('SEED_DEMO_PASSWORD is required — no hardcoded fallback exists on purpose.');
  }
  if (DEMO_PASSWORD.length < MIN_PASSWORD_LENGTH || isBlocklisted(DEMO_PASSWORD)) {
    throw new Error(
      `SEED_DEMO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} chars and not a common password.`
    );
  }

  await mongoose.connect(env.mongoUri);
  logger.info('Connected to database for DEMO user seeding (production, explicit opt-in)');

  const results = [];
  for (const spec of USERS_TO_SEED) {
    // eslint-disable-next-line no-await-in-loop -- sequential seeding, negligible one-time cost
    const result = await seedOneUser(spec);
    if (result) results.push(result);
  }

  // console.log ONLY — never logger.* — so secrets never reach persistent
  // log storage, only the ephemeral interactive shell session.
  /* eslint-disable no-console -- CLI seed script: this block IS the user-facing
       output (one-time TOTP secrets), deliberately never routed through logger.* */
  console.log('\n=== DEMO SEED SUMMARY — copy this now, it will not be shown again ===');
  console.log('Delete or suspend these accounts after grading is complete.\n');
  results.forEach((r) => {
    console.log(`[${r.role}] ${r.email}`);
    if (r.rawSecret) {
      console.log(`  TOTP manual entry key: ${r.rawSecret}`);
    }
    console.log('');
  });
  /* eslint-enable no-console */

  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Demo seed failed', { error: err.message });
  console.error(err);
  // process.exitCode (not process.exit()) lets any pending async work —
  // e.g. the logger flush above, or a partially-open mongoose connection —
  // finish naturally instead of being cut off mid-write.
  process.exitCode = 1;
});
