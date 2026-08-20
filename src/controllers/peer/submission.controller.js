// src/controllers/peer/submission.controller.js
const peerService = require('../../services/peerService');

/** POST /api/v1/peer/assignments/:assignmentId/submit */
async function submitAssignment(req, res, next) {
  try {
    const studentId = req.user.id;
    const { assignmentId } = req.params;
    const { textContent } = req.validatedBody || {};

    const result = await peerService.submitAssignment({
      studentId,
      assignmentId,
      textContent,
      file: req.file, // multer .single('file') — اختياري
      req,
    });
    return res.status(201).json({ success: true, message: 'Submission received.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/assignments/:assignmentId/my-submission */
async function getMySubmission(req, res, next) {
  try {
    const studentId = req.user.id;
    const { assignmentId } = req.params;
    const result = await peerService.getMySubmission({ studentId, assignmentId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { submitAssignment, getMySubmission };
