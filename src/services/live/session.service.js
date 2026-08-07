// src/services/live/session.service.js
// UC-LIVE-01 (Create/Schedule) | UC-LIVE-02 (Edit/Cancel) | UC-LIVE-03 (View Schedule)
// UC-LIVE-08 (End & Process Recording)

const LiveSession = require('../../models/liveSession.model');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

/** يتحقق أن المحاضر يملك الكورس فعلياً — نفس فحص الملكية المستخدم في COURSE */
async function assertInstructorOwnsCourse({ instructorId, courseId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'الكورس غير موجود.');
  }
  if (course.owner_instructor_id.toString() !== instructorId.toString()) {
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_LIVE_SESSION_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: courseId.toString(),
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية إدارة جلسات هذا الكورس.');
  }
  return course;
}

/** يتحقق أن المحاضر يملك الجلسة فعلياً، ويعيدها (وثيقة Mongoose قابلة للتعديل) */
async function assertInstructorOwnsSession({ instructorId, sessionId, req }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const session = await LiveSession.findById(safeSessionId);
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }
  if (session.instructorId.toString() !== instructorId.toString()) {
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_LIVE_SESSION_ACCESS_ATTEMPT',
      resourceType: 'LiveSession',
      resourceId: safeSessionId.toString(),
      metadata: { target_owner: session.instructorId },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية إدارة هذه الجلسة.');
  }
  return session;
}

/** يتحقق من وجود تعارض زمني مع جلسة أخرى لنفس الكورس (باستثناء الجلسة الحالية عند التعديل) */
async function findConflictingSession({ courseId, startTime, endTime, excludeSessionId = null }) {
  const query = {
    courseId,
    status: { $in: ['scheduled', 'ongoing'] },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };
  if (excludeSessionId) {
    query._id = { $ne: excludeSessionId };
  }
  return LiveSession.findOne(query).lean();
}

/**
 * UC-LIVE-01 — Create/Schedule Session
 */
async function createSession({ instructorId, sessionData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(sessionData.courseId, 'courseId');

  await assertInstructorOwnsCourse({ instructorId: safeInstructorId, courseId: safeCourseId, req });

  const startTime = new Date(sessionData.startTime);
  const endTime = new Date(sessionData.endTime);
  const now = new Date();

  if (startTime <= now) {
    throw new AppError(400, 'INVALID_START_TIME', 'يجب أن يكون وقت بدء الجلسة في المستقبل.');
  }
  if (endTime <= startTime) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'وقت النهاية يجب أن يكون بعد وقت البداية.');
  }

  const conflict = await findConflictingSession({ courseId: safeCourseId, startTime, endTime });
  if (conflict && !sessionData.confirmConflict) {
    // منطق "تعارض ناعم": نرفض بـ 409 مع بيانات التعارض، ويمكن للمحاضر تجاوزه
    // صراحةً عبر confirmConflict=true في طلب لاحق (بدل حظر التعارض حظراً كاملاً).
    throw new AppError(
      409,
      'SESSION_TIME_CONFLICT',
      'يوجد تعارض زمني مع جلسة أخرى لنفس الكورس. أرسل confirmConflict=true للمتابعة رغم ذلك.',
      { conflictingSessionId: conflict._id }
    );
  }

  const session = await LiveSession.create({
    courseId: safeCourseId,
    instructorId: safeInstructorId,
    title: sessionData.title,
    meetingLink: sessionData.meetingLink,
    startTime,
    endTime,
    lobbyEnabled: Boolean(sessionData.lobbyEnabled),
    status: 'scheduled',
  });

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'LIVE_SESSION_CREATED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { courseId: safeCourseId.toString(), startTime, endTime },
    req,
  });

  return { success: true, data: { session } };
}

/**
 * UC-LIVE-02 — Edit Session
 */
async function updateSession({ instructorId, sessionId, updateData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const session = await assertInstructorOwnsSession({
    instructorId: safeInstructorId,
    sessionId,
    req,
  });

  if (session.status !== 'scheduled') {
    throw new AppError(
      400,
      'SESSION_NOT_EDITABLE',
      'لا يمكن تعديل جلسة بدأت بالفعل أو انتهت أو أُلغيت.'
    );
  }

  const nextStart = updateData.startTime ? new Date(updateData.startTime) : session.startTime;
  const nextEnd = updateData.endTime ? new Date(updateData.endTime) : session.endTime;

  if (nextEnd <= nextStart) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'وقت النهاية يجب أن يكون بعد وقت البداية.');
  }

  if (updateData.startTime || updateData.endTime) {
    const conflict = await findConflictingSession({
      courseId: session.courseId,
      startTime: nextStart,
      endTime: nextEnd,
      excludeSessionId: session._id,
    });
    if (conflict && !updateData.confirmConflict) {
      throw new AppError(
        409,
        'SESSION_TIME_CONFLICT',
        'يوجد تعارض زمني مع جلسة أخرى لنفس الكورس. أرسل confirmConflict=true للمتابعة رغم ذلك.',
        { conflictingSessionId: conflict._id }
      );
    }
  }

  const changedFields = {};
  ['title', 'meetingLink', 'lobbyEnabled'].forEach((field) => {
    if (updateData[field] !== undefined) {
      changedFields[field] = updateData[field];
      session[field] = updateData[field];
    }
  });
  if (updateData.startTime) {
    changedFields.startTime = nextStart;
    session.startTime = nextStart;
  }
  if (updateData.endTime) {
    changedFields.endTime = nextEnd;
    session.endTime = nextEnd;
  }

  await session.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'LIVE_SESSION_UPDATED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { changedFields },
    req,
  });

  // TODO(email): إشعار الطلاب المسجلين بالتعديل — يعيد استخدام نمط
  // sendLiveSessionScheduledNotification في emailService.js إن كانت موجودة
  // بنفس التوقيع المفترَض سابقاً (افتراض معلَّق من UC-LIVE-01 الأصلية).

  return { success: true, data: { session } };
}

/**
 * UC-LIVE-02 — Cancel Session
 */
async function cancelSession({ instructorId, sessionId, reason, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const session = await assertInstructorOwnsSession({
    instructorId: safeInstructorId,
    sessionId,
    req,
  });

  if (session.status === 'cancelled') {
    throw new AppError(400, 'ALREADY_CANCELLED', 'الجلسة ملغاة بالفعل.');
  }
  if (session.status === 'ended') {
    throw new AppError(400, 'SESSION_ALREADY_ENDED', 'لا يمكن إلغاء جلسة انتهت بالفعل.');
  }

  session.status = 'cancelled';
  session.cancelReason = reason || null;
  session.cancelledAt = new Date();
  await session.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'LIVE_SESSION_CANCELLED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { reason: reason || null },
    req,
  });

  // TODO(email): إشعار الطلاب المسجلين بالإلغاء (نفس ملاحظة updateSession أعلاه)

  return { success: true, data: { session } };
}

/**
 * UC-LIVE-03 — View Live Schedule
 * الطالب: جلسات كورساته المسجَّل بها فقط (فحص خادمي عبر Enrollment، وليس ثقة بالعميل)
 * المحاضر: جلساته الخاصة فقط
 */
async function listSessionsForViewer({ userId, role, queryParams = {} }) {
  const safeUserId = toObjectId(userId, 'userId');
  const filter = {};

  if (
    queryParams.status &&
    ['scheduled', 'ongoing', 'ended', 'cancelled'].includes(queryParams.status)
  ) {
    filter.status = queryParams.status;
  } else {
    // افتراضي: القادمة والمستمرة فقط (استبعاد المنتهية/الملغاة ما لم يُطلب صراحةً)
    filter.status = { $in: ['scheduled', 'ongoing'] };
  }

  if (role === 'Instructor') {
    filter.instructorId = safeUserId;
  } else {
    // Student — القيد الخادمي: كورسات هذا الطالب فعلياً حسب Enrollment، لا حسب مدخلات العميل
    const activeEnrollments = await Enrollment.find({ student_id: safeUserId, status: 'active' })
      .select('course_id')
      .lean();
    const courseIds = activeEnrollments.map((e) => e.course_id);
    if (courseIds.length === 0) {
      return { success: true, data: { sessions: [] } };
    }
    filter.courseId = { $in: courseIds };
  }

  const sessions = await LiveSession.find(filter).sort({ startTime: 1 }).lean();
  return { success: true, data: { sessions } };
}

/**
 * UC-LIVE-08 — End Session
 */
async function endSession({ instructorId, sessionId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const session = await assertInstructorOwnsSession({
    instructorId: safeInstructorId,
    sessionId,
    req,
  });

  if (session.status === 'ended') {
    throw new AppError(400, 'ALREADY_ENDED', 'الجلسة منتهية بالفعل.');
  }
  if (session.status === 'cancelled') {
    throw new AppError(400, 'SESSION_CANCELLED', 'لا يمكن إنهاء جلسة ملغاة.');
  }

  session.status = 'ended';
  session.endedAt = new Date();
  session.recordingStatus = 'processing';
  await session.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'LIVE_SESSION_ENDED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: {},
    req,
  });

  return { success: true, data: { session } };
}

/**
 * UC-LIVE-08 — Attach Recording (بعد اكتمال المعالجة/الرفع للسحابة خارجياً)
 * DEVIATION: رفع الفيديو الفعلي للسحابة خارج نطاق هذا التسليم — هذه الدالة
 * تُسجِّل فقط الرابط النهائي بعد اكتمال المعالجة (استدعاء لاحق يدوي من
 * المحاضر أو Webhook من خدمة المعالجة الخارجية).
 */
async function attachRecording({ instructorId, sessionId, recordingUrl, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const session = await assertInstructorOwnsSession({
    instructorId: safeInstructorId,
    sessionId,
    req,
  });

  if (session.status !== 'ended') {
    throw new AppError(400, 'SESSION_NOT_ENDED', 'يجب إنهاء الجلسة أولاً قبل إرفاق التسجيل.');
  }

  session.recordingUrl = recordingUrl;
  session.recordingStatus = 'ready';
  await session.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'LIVE_SESSION_RECORDING_ATTACHED',
    resourceType: 'LiveSession',
    resourceId: session._id.toString(),
    metadata: { recordingUrl },
    req,
  });

  return { success: true, data: { session } };
}

module.exports = {
  createSession,
  updateSession,
  cancelSession,
  listSessionsForViewer,
  endSession,
  attachRecording,
  assertInstructorOwnsSession, // يُعاد تصديره لاستخدامه من moderation.service.js / chat.service.js
};
