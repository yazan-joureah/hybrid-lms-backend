// scripts/seedLiveDemoData.js
/**
 * يجهّز بيانات جاهزة لاختبار وحدتي LIVE + ATT عبر Postman مباشرة، بدون
 * المرور يدوياً بتدفق MFA الكامل لكل تشغيل (Instructor يتطلب MFA عند
 * تسجيل الدخول العادي — UC-AUTH-05). هذا السكربت يوقّع Access Token
 * صالحاً مباشرة (بنفس آلية jwt.js الحقيقية)، تماماً كما تفعل ملفات
 * الاختبار الآلي (tests/integration/*.test.js)، وهي وسيلة تطويرية مقبولة
 * — الحسابات نفسها لا تزال تمر بكل فحوصات KYC/MFA الحقيقية داخل كل
 * Middleware عند استخدام التوكن.
 *
 * المتطلبات المسبقة: شغّلي `npm run seed:dev-users` مرة واحدة أولاً
 * (ينشئ instructor@dev.local وstudent@dev.local).
 *
 * الاستخدام: node scripts/seedLiveDemoData.js
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('seedLiveDemoData.js must never run with NODE_ENV=production.');
}

const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Course = require('../src/models/Course');
const Enrollment = require('../src/models/Enrollment');
const { signAccessToken } = require('../src/utils/jwt');

async function signInAsDevSeedUser(email) {
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error(
      `${email} not found — run "npm run seed:dev-users" first (creates instructor@dev.local / student@dev.local).`
    );
  }

  const session = await Session.create({
    user_id: user._id,
    device_fingerprint: 'postman-demo',
    ip_address: '127.0.0.1',
    user_agent: 'postman-seed-script',
    mfa_verified: true,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  return { user, accessToken };
}

async function run() {
  await mongoose.connect(env.mongoUri);

  const { user: instructor, accessToken: instructorAccessToken } =
    await signInAsDevSeedUser('instructor@dev.local');
  const { user: student, accessToken: studentAccessToken } =
    await signInAsDevSeedUser('student@dev.local');

  let course = await Course.findOne({
    owner_instructor_id: instructor._id,
    title: 'LIVE Demo Course (Postman)',
  });

  if (!course) {
    course = await Course.create({
      owner_instructor_id: instructor._id,
      title: 'LIVE Demo Course (Postman)',
      description: 'Course created by seedLiveDemoData.js for LIVE/ATT Postman testing.',
      category: 'Technology & Computer Science',
      course_type: 'free',
      is_synchronous: true,
      status: 'published',
    });
  }

  const existingEnrollment = await Enrollment.findOne({
    course_id: course._id,
    student_id: student._id,
  });
  if (!existingEnrollment) {
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
    });
  }

  logger.info('=== LIVE/ATT Postman demo data ready ===');
  console.log('\nPaste these into your Postman environment/collection variables:\n');
  console.log(`instructorAccessToken = ${instructorAccessToken}`);
  console.log(`studentAccessToken    = ${studentAccessToken}`);
  console.log(`demoCourseId          = ${course._id}`);
  console.log(
    '\n(Access tokens are valid for 15 minutes — re-run this script to mint fresh ones.)\n'
  );

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  logger.error('seedLiveDemoData failed', { error: err.message });
  console.error(err.message);
  process.exit(1);
});
