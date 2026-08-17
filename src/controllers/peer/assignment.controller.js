// src/controllers/peer/assignment.controller.js
// UC-PEER-01 — Create Peer Assessment Task
const peerService = require('../../services/peerService');

/** POST /api/v1/peer/assignments */
async function createAssignment(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await peerService.createAssignment({
      instructorId,
      assignmentData: req.validatedBody,
      req,
    });
    return res.status(201).json({
      success: true,
      message: 'Peer assessment task created and published.',
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/assignments */
async function listAssignments(req, res, next) {
  try {
    const result = await peerService.listAssignmentsForViewer({
      userId: req.user.id,
      role: req.verifiedRole,
      queryParams: req.query,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/assignments/:assignmentId */
async function getAssignment(req, res, next) {
  try {
    const { assignmentId } = req.params;
    const result = await peerService.getAssignmentDetails({
      userId: req.user.id,
      role: req.verifiedRole,
      assignmentId,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createAssignment, listAssignments, getAssignment };
