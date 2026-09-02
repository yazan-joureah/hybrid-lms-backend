const { getAdminAnalyticsOverview } = require('../../services/report/adminAnalytics.service');

async function getAnalyticsOverview(req, res, next) {
  try {
    const result = await getAdminAnalyticsOverview({
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      req,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getAnalyticsOverview };
