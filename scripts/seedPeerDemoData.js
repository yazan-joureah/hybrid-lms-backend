// scripts/seedPeerDemoData.js
/**
 * يجهّز بيانات جاهزة لاختبار وحدة PEER عبر Postman مباشرة: محاضر واحد،
 * 3 طلاب (الحد الأدنى لتوزيع UC-PEER-02)، كورس، وتسجيل فعّال للجميع —
 * ثم يوقّع Access Tokens صالحة مباشرة (بنفس منطق seedLiveDemoData.js).
 *
 * الاستخدام: node scripts/seedPeerDemoData.js
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('seedPeerDemoData.js must never run with NODE_ENV=production.');
}

const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Course = require('../src/models/Course');
const Enrollment = require('../src/models/Enrollment');
const { hashPassword } = require('../src/utils/crypto');
const { signAccessToken } = require('../src/utils/jwt');

const PASSWORD = 'a-genuinely-long-passphrase-2026';

async function findOrCreateUser({ email, role }) {
  let user = await User.findOne({ email });
  if (!user) {
    const password_hash = await hashPassword(PASSWORD);
    user = await User.create({
      full_name: `Peer Demo ${role}`,
      email,
      password_hash,
      birth_date: new Date('1995-01-01'),
      role,
      status: 'active',
      email_verified_at: new Date(),
      kyc_status: 'verified',
      mfa_enabled: true,
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
    device_fingerprint: 'postman-peer-demo',
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

  const instructor = await findOrCreateUser({ email: 'peer-instructor@dev.local', role: 'Instructor' });
  const instructorAccessToken = await mintAccessToken(instructor);

  let course = await Course.findOne({
    owner_instructor_id: instructor._id,
    title: 'PEER Demo Course (Postman)',
  });
  if (!course) {
    course = await Course.create({
      owner_instructor_id: instructor._id,
      title: 'PEER Demo Course (Postman)',
      description: 'Course created by seedPeerDemoData.js for PEER Postman testing.',
      category: 'Technology & Computer Science',
      course_type: 'free',
      is_synchronous: false,
      status: 'published',
    });
  }

  const studentTokens = [];
  for (let i = 1; i <= 3; i += 1) {
    const student = await findOrCreateUser({ email: `peer-student${i}@dev.local`, role: 'Student' });
    const accessToken = await mintAccessToken(student);
    studentTokens.push({ email: student.email, id: student._id.toString(), accessToken });

    const existing = await Enrollment.findOne({ course_id: course._id, student_id: student._id });
    if (!existing) {
      await Enrollment.create({
        course_id: course._id,
        student_id: student._id,
        status: 'active',
        confirmed_by_student: true,
      });
    }
  }

  logger.info('=== PEER Postman demo data ready ===');
  console.log('\nPaste these into your Postman collection variables:\n');
  console.log(`instructorAccessToken = ${instructorAccessToken}`);
  console.log(`demoCourseId          = ${course._id}`);
  studentTokens.forEach((s, i) => {
    console.log(`student${i + 1}AccessToken   = ${s.accessToken}`);
    console.log(`student${i + 1}Id            = ${s.id}   (${s.email})`);
  });
  console.log('\n(Access tokens are valid for 15 minutes — re-run this script to mint fresh ones.)\n');

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  logger.error('seedPeerDemoData failed', { error: err.message });
  console.error(err.message);
  process.exit(1);
});
