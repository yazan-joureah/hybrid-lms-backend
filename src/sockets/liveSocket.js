/**
 * src/sockets/liveSocket.js
 * طبقة البث اللحظي التكميلية لوحدة LIVE (الدردشة، غرفة الانتظار، الإشراف).
 *
 * ملاحظة معمارية مهمة: كل عملية تُغيّر بيانات (رسالة، كتم، طرد...) تمر أولاً
 * عبر REST endpoint المطابق في liveRoutes.js — الذي يتحقق من الصلاحيات،
 * يحفظ في MongoDB، يكتب Audit Log، ثم يبثّ الحدث هنا عبر getIO(). هذا الملف
 * لا يحتوي أي منطق أعمال جديد؛ فقط: (أ) مصادقة الاتصال، (ب) إدارة الغرف
 * (Socket.IO rooms)، (ج) استقبال "مغادرة" الطالب لإنهاء تتبع الحضور (UC-ATT-01).
 *
 * لماذا REST أولاً وليس Socket أولاً؟ لضمان أن كل تغيير قابل للاختبار عبر
 * Postman (متطلب صريح)، ولأن REST يعطي استجابة فورية بنجاح/فشل الطلب —
 * بينما Socket يبقى طبقة "دفع" (push) تكميلية للمشاركين المتصلين حالياً فقط.
 */

const { verifyJoinToken } = require('../utils/joinToken.util');
const { verifyAccessToken } = require('../utils/jwt');
const LiveSession = require('../models/liveSession.model');
const { recordAttendanceLeave } = require('../services/attendance/tracking.service');
const logger = require('../utils/logger');

/**
 * يصادق اتصال Socket.IO الوارد: إما joinToken (طالب) أو Access Token عادي (محاضر).
 * يُعيد { role, userId, sessionId } أو يرمي خطأ (يرفضه Socket.IO تلقائياً).
 */
async function authenticateSocket(socket) {
  const { joinToken, accessToken } = socket.handshake.auth || {};

  if (joinToken) {
    const payload = verifyJoinToken(joinToken); // يرمي AppError إن كان غير صالح/منتهياً
    return { role: 'Student', userId: payload.studentId, sessionId: payload.sessionId };
  }

  if (accessToken) {
    const decoded = verifyAccessToken(accessToken);
    const sessionId = socket.handshake.query?.sessionId;
    if (!sessionId) {
      throw new Error('sessionId query param is required for instructor connections');
    }
    const session = await LiveSession.findById(sessionId).select('instructorId').lean();
    if (!session || session.instructorId.toString() !== decoded.sub) {
      throw new Error('Not authorized for this session');
    }
    return { role: 'Instructor', userId: decoded.sub, sessionId: String(sessionId) };
  }

  throw new Error('joinToken or accessToken is required to connect');
}

/**
 * @param {import('socket.io').Server} io
 */
function registerLiveSocket(io) {
  const nsp = io.of('/live');

  nsp.use(async (socket, next) => {
    try {
      const identity = await authenticateSocket(socket);
      socket.data.identity = identity;
      return next();
    } catch (err) {
      return next(new Error(err.message || 'Unauthorized socket connection'));
    }
  });

  nsp.on('connection', (socket) => {
    const { role, userId, sessionId } = socket.data.identity;

    socket.join(`live:${sessionId}`);
    socket.join(`live:${sessionId}:user:${userId}`);
    if (role === 'Student') {
      socket.join(`live:${sessionId}:lobby:${userId}`);
    } else {
      socket.join(`live:${sessionId}:lobby`); // المحاضر يستقبل إشعارات الوافدين الجدد لغرفة الانتظار
    }

    logger.info('Live socket connected', { role, userId, sessionId });

    socket.on('disconnect', async () => {
      logger.info('Live socket disconnected', { role, userId, sessionId });
      if (role !== 'Student') return;

      // أفضل جهد فقط (best-effort) — الاعتماد الأساسي في ATT-01 على
      // POST /sessions/:sessionId/leave الصريح؛ هذا يغطي حالة إغلاق التبويب
      // المفاجئ دون استدعاء ذلك الـ endpoint.
      try {
        await recordAttendanceLeave({ studentId: userId, sessionId });
      } catch (err) {
        // لا سجل حضور موجود أصلاً، أو حالات أخرى غير حرجة — تجاهل صامت مقصود
        logger.debug('Best-effort attendance leave on disconnect skipped', { error: err.message });
      }
    });
  });

  return nsp;
}

module.exports = { registerLiveSocket };
