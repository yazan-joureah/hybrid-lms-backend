const liveService = require('../services/liveService');

/**
 * UC-LIVE-01 — POST /api/v1/live/sessions/:sessionId/join
 * الفاعل: Student
 */
async function joinSession(req, res, _next) {
  try {
    const { sessionId } = req.params;
    const studentId = req.user.id; // JWT فقط — لا تُستخرج الهوية من req.body إطلاقاً

    const result = await liveService.joinLiveSession({ studentId, sessionId, req });
    return res.status(200).json(result);
  } catch (err) {
    // إذا كان الخطأ هو عدم تسجيل الطالب في الكورس أو أي خطأ عملي (Business Logic Error)
    const statusCode = err.statusCode || err.status || 400;

    return res.status(typeof statusCode === 'number' ? statusCode : 400).json({
      success: false,
      message: err.message || 'فشلت عملية الانضمام للجلسة',
    });
  }
}

module.exports = {
  joinSession,
};
