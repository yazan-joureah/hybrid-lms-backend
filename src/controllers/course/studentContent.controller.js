const {
  getCourseContentForStudent,
  streamContentFile,
  streamContentFileForInstructor,
} = require('../../services/courseService');

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

async function downloadFile(req, res, next) {
  try {
    const userId = req.user.id;
    // Use verifiedRole from requireRole middleware, fallback to user.role
    const userRole = req.verifiedRole || req.user.role;

    const { courseId, contentId } = req.params;

    let stream, contentType, filename;

    if (userRole && userRole.toLowerCase() === 'instructor') {
      const result = await streamContentFileForInstructor({
        instructorId: userId,
        courseId,
        contentId,
      });
      stream = result.stream;
      contentType = result.contentType;
      filename = result.filename;
    } else {
      const result = await streamContentFile({
        studentId: userId,
        courseId,
        contentId,
      });
      stream = result.stream;
      contentType = result.contentType;
      filename = result.filename;
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    console.error('downloadFile error:', err);
    next(err);
  }
}

module.exports = { getContent, downloadFile };
