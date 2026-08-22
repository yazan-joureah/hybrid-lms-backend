/**
 * src/jobs/peerCron.job.js
 * المُشغِّل الزمني (System — لا يبدأه إنسان) لـ:
 *   - UC-PEER-02: توزيع المراجعات فور انتهاء مهلة تسليم أي مهمة (status='open')
 *   - UC-PEER-04: احتساب الدرجات النهائية فور انتهاء مهلة مراجعة أي مهمة
 *     (status='distributed')
 *
 * كلا الاستدعاءين إلى peerService في هذا الملف مصمَّمان Idempotent بالفعل
 * (راجع allocation.service.js / grading.service.js) — تشغيل هذه الوظيفة
 * أكثر من مرة على نفس المهمة لا يُكرِّر أي عمل ولا يُنتِج أخطاء.
 */
const cron = require('node-cron');
const PeerAssignment = require('../models/peerAssignment.model');
const peerService = require('../services/peerService');
const logger = require('../utils/logger');

async function runDistributionSweep() {
  const dueAssignments = await PeerAssignment.find({
    status: 'open',
    submissionDeadline: { $lte: new Date() },
  })
    .select('_id')
    .lean();

  for (const { _id } of dueAssignments) {
    try {
      await peerService.distributeReviews({ assignmentId: _id, actorId: null, actorRole: 'System' });
      logger.info('PEER cron: distributed reviews', { assignmentId: _id.toString() });
    } catch (err) {
      // فشل توزيع مهمة واحدة (مثلاً INSUFFICIENT_SUBMISSIONS) لا يوقف بقية الدورة
      logger.error('PEER cron: distribution failed', {
        assignmentId: _id.toString(),
        error: err.message,
      });
    }
  }
}

async function runGradingSweep() {
  const dueAssignments = await PeerAssignment.find({
    status: 'distributed',
    reviewDeadline: { $lte: new Date() },
  })
    .select('_id')
    .lean();

  for (const { _id } of dueAssignments) {
    try {
      await peerService.calculateFinalGrades({ assignmentId: _id, actorId: null, actorRole: 'System' });
      logger.info('PEER cron: final grades calculated', { assignmentId: _id.toString() });
    } catch (err) {
      logger.error('PEER cron: grading failed', { assignmentId: _id.toString(), error: err.message });
    }
  }
}

/**
 * يسجّل الوظيفتين الزمنيتين. يُستدعى مرة واحدة عند إقلاع السيرفر (server.js).
 * DEVIATION: كل دقيقتين — كافٍ لبيئة تطوير/عرض؛ في الإنتاج الفعلي يُفضَّل
 * تقليل التكرار (مثلاً كل 15 دقيقة) لتقليل الحمل على قاعدة البيانات.
 */
function registerPeerCronJobs() {
  cron.schedule('*/2 * * * *', async () => {
    await runDistributionSweep();
    await runGradingSweep();
  });
  logger.info('PEER cron jobs registered (every 2 minutes)');
}

module.exports = { registerPeerCronJobs, runDistributionSweep, runGradingSweep };
