const { recordProgress, getProgressSummary } = require('../services/progress.service');

/** UC-COURSE-04: records a content-completion event, server-computed progress. */
async function record(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const { content_id: contentId } = req.body;

    const result = await recordProgress({ studentId, courseId, contentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function getProgress(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await getProgressSummary({ studentId, courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { record, getProgress };
