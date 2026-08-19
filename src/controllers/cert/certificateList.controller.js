// src/controllers/cert/certificateList.controller.js
// UC-CERT-07 — GET /api/v1/certificates/my-certificates
const { listMyCertificates } = require('../../services/cert/certificateList.service');
const { downloadCertificate } = require('../../services/cert/certificate.service');

async function listMine(req, res, next) {
  try {
    const studentId = req.user.id;
    const result = await listMyCertificates({ studentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function download(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await downloadCertificate({ studentId, courseId, req });

    const cert = result.data.certificate;
    return res.status(200).json({
      success: true,
      data: {
        certificate_id: cert.certificate_id,
        student_name: cert.student_name_snapshot,
        course_title: cert.course_title_snapshot,
        issued_at: cert.issued_at,
        qr_code_image_base64: cert.qr_code_image.toString('base64'),
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listMine, download };
