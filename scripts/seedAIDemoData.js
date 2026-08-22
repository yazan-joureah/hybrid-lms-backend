// scripts/seedAIDemoData.js
/**
 * يجهّز بيانات جاهزة لاختبار وحدة AI عبر Postman مباشرة: محاضر واحد
 * (KYC + MFA مُفعَّلان، مطلوبان لـ UC-AI-04/05/06)، طالب واحد (جلسة صالحة
 * فقط تكفي لـ UC-AI-01/02/03)، كورس، وتسجيل فعّال للطالب — ثم يوقّع
 * Access Tokens صالحة مباشرة (نفس منطق seedPeerDemoData.js / seedLiveDemoData.js).
 *
 * الاستخدام: node scripts/seedAIDemoData.js
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('seedAIDemoData.js must never run with NODE_ENV=production.');
}

const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Course = require('../src/models/Course');
const CourseUnit = require('../src/models/CourseUnit');
const Enrollment = require('../src/models/Enrollment');
const { hashPassword } = require('../src/utils/crypto');
const { signAccessToken } = require('../src/utils/jwt');

const PASSWORD = 'a-genuinely-long-passphrase-2026';

async function findOrCreateUser({ email, role }) {
  let user = await User.findOne({ email });
  if (!user) {
    const password_hash = await hashPassword(PASSWORD);
    user = await User.create({
      full_name: `AI Demo ${role}`,
      email,
      password_hash,
      birth_date: new Date('1995-01-01'),
      role,
      status: 'active',
      email_verified_at: new Date(),
      kyc_status: 'verified', // Instructor يحتاجها لـ requireVerifiedIdentity (FR-42)
      mfa_enabled: true, // Instructor يحتاجها لـ requireVerifiedIdentity (FR-37)
      privacy_consent: {
        policy_version: 'v1.0',
        accepted_at: new Date(),
        ip: '127.0.0.1',
        user_agent: 'seed-script',
      },
    });
  }
  return user;
}

async function mintAccessToken(user) {
  const session = await Session.create({
    user_id: user._id,
    device_fingerprint: 'postman-ai-demo',
    ip_address: '127.0.0.1',
    user_agent: 'postman-seed-script',
    mfa_verified: true,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return signAccessToken({ userId: user._id, sessionId: session._id });
}

async function run() {
  await mongoose.connect(env.mongoUri);

  const instructor = await findOrCreateUser({ email: 'ai-instructor@dev.local', role: 'Instructor' });
  const instructorAccessToken = await mintAccessToken(instructor);

  let course = await Course.findOne({
    owner_instructor_id: instructor._id,
    title: 'AI Demo Course (Postman)',
  });
  if (!course) {
    course = await Course.create({
      owner_instructor_id: instructor._id,
      title: 'AI Demo Course (Postman)',
      description: 'Course created by seedAIDemoData.js for AI Assistant Postman testing.',
      category: 'Technology & Computer Science',
      course_type: 'free',
      is_synchronous: false,
      status: 'published',
    });
  }

  // وحدتان — لتظهرا فعلياً في System Prompt المُحقَن (SF-AI-01/SF-AI-02)
  const existingUnits = await CourseUnit.countDocuments({ course_id: course._id });
  if (existingUnits === 0) {
    await CourseUnit.create([
      { course_id: course._id, title: 'Unit 1 — Introduction', order: 1 },
      { course_id: course._id, title: 'Unit 2 — Core Concepts', order: 2 },
    ]);
  }

  const student = await findOrCreateUser({ email: 'ai-student@dev.local', role: 'Student' });
  const studentAccessToken = await mintAccessToken(student);

  const existingEnrollment = await Enrollment.findOne({ course_id: course._id, student_id: student._id });
  if (!existingEnrollment) {
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
    });
  }

  logger.info('=== AI Postman demo data ready ===');
  console.log('\nPaste these into your Postman collection variables:\n');
  console.log(`instructorAccessToken = ${instructorAccessToken}`);
  console.log(`demoCourseId          = ${course._id}`);
  console.log(`studentAccessToken    = ${studentAccessToken}`);
  console.log(`studentUserId         = ${student._id}`);
  console.log('\n(Access tokens are valid for 15 minutes — re-run this script to mint fresh ones.)\n');

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  logger.error('seedAIDemoData failed', { error: err.message });
  console.error(err.message);
  process.exit(1);
});
