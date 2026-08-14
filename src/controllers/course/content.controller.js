// src/controllers/course/content.controller.js
const {
  addContent,
  updateContent,
  deleteContent,
  reorderContents,
  streamContentFile,
} = require('../../services/courseService');

async function createContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const { content_type: contentType, title, desc, url, text } = req.body;
    const contentData =
      contentType === 'link' ? { url } : contentType === 'text' ? { text } : undefined;

    const result = await addContent({
      courseId,
      unitId,
      instructorId,
      contentType,
      title,
      desc,
      file: req.file,
      contentData,
      req,
    });
    return res.status(201).json({
      success: true,
      data: { content: result.data.content, unit_content: result.data.unit_content },
    });
  } catch (err) {
    return next(err);
  }
}

async function updateOneContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId, contentId } = req.params;
    const { title, desc, url, text } = req.body;
    const result = await updateContent({
      courseId,
      unitId,
      contentId,
      instructorId,
      title,
      desc,
      contentData: { url, text },
      file: req.file,
      req,
    });
    return res.status(200).json({ success: true, data: { content: result.data.content } });
  } catch (err) {
    return next(err);
  }
}

async function removeContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId, contentId } = req.params;
    await deleteContent({ courseId, unitId, contentId, instructorId, req });
    return res.status(200).json({ success: true, message: 'Content deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function reorderContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const result = await reorderContents({
      courseId,
      unitId,
      instructorId,
      orderedContentIds: req.body.ordered_content_ids,
      req,
    });
    return res.status(200).json({ success: true, data: { content: result.data.content } });
  } catch (err) {
    return next(err);
  }
}

/**  file streaming — Student/Instructor/Admin. */
async function downloadFile(req, res, next) {
  try {
    const userId = req.user.id;
    const role = req.verifiedRole || req.user.role;
    const { courseId, contentId } = req.params;

    const { stream, contentType, filename } = await streamContentFile({
      userId,
      role,
      courseId,
      contentId,
    });
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createContent,
  updateOneContent,
  removeContent,
  reorderContent,
  downloadFile,
};
