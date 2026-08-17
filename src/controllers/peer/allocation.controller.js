// src/controllers/peer/allocation.controller.js
// UC-PEER-02 — يُستدعى تلقائياً من jobs/peerCron.job.js، وهذا المسار خيار
// احتياطي يدوي للمحاضر/الإدارة (مثلاً لتجربة النظام قبل انتظار الـ Cron)
const peerService = require('../../services/peerService');

/** POST /api/v1/peer/assignments/:assignmentId/distribute */
async function distribute(req, res, next) {
  try {
    const { assignmentId } = req.params;
    const result = await peerService.distributeReviews({
      assignmentId,
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { distribute };
