// src/controllers/course/courseImage.controller.js
const {
  setCourseCoverImage,
  streamCourseCoverImage,
} = require('../../services/course/courseImage.service');

async function setCover(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await setCourseCoverImage({ courseId, instructorId, file: req.file, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function streamCover(req, res, next) {
  try {
    const { courseId } = req.params;
    const { stream, contentType, filename } = await streamCourseCoverImage({ courseId });
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = { setCover, streamCover };
