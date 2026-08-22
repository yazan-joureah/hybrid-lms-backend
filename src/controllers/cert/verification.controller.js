// src/controllers/cert/verification.controller.js
// UC-CERT-04 — GET /api/v1/certificates/verify/:certificateId
const { verifyCertificate } = require('../../services/cert/verification.service');

async function verify(req, res, next) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { certificateId } = req.params;
    const result = await verifyCertificate({ certificateId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { verify };
