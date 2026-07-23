const { getCourseContentForStudent, streamContentFile } = require('../../services/courseService');

/** Returns the enrolled student's view of the course outline. */
async function getContent(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await getCourseContentForStudent({ studentId, courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Streams a content item's file directly to the client. */
async function downloadFile(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId, contentId } = req.params;
    const { stream, contentType, filename } = await streamContentFile({
      studentId,
      courseId,
      contentId,
    });

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { getContent, downloadFile };
