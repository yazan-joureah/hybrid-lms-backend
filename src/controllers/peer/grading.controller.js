// src/controllers/peer/grading.controller.js
// UC-PEER-04 — Calculate Final Peer Grade & Alert Instructor
const peerService = require('../../services/peerService');

/** POST /api/v1/peer/assignments/:assignmentId/calculate-grades (خيار احتياطي يدوي) */
async function calculateGrades(req, res, next) {
  try {
    const { assignmentId } = req.params;
    const result = await peerService.calculateFinalGrades({
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

/** GET /api/v1/peer/assignments/:assignmentId/grades */
async function getGrades(req, res, next) {
  try {
    const { assignmentId } = req.params;
    const result = await peerService.getGradeSummary({
      userId: req.user.id,
      role: req.verifiedRole,
      assignmentId,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { calculateGrades, getGrades };
