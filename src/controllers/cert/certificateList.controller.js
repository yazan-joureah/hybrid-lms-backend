// src/controllers/cert/certificateList.controller.js
const { listMyCertificates } = require('../../services/cert/certificateList.service');
const { downloadCertificate } = require('../../services/cert/certificate.service');
const { issueCredentialJwt } = require('../../services/cert/credential.service');
const Course = require('../../models/Course');

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

    const course = await Course.findById(cert.course_id)
      .select('certificate_criteria description')
      .lean();
    const { token } = issueCredentialJwt({
      certificate: cert,
      criteriaNarrative: course?.certificate_criteria,
      courseDescription: course?.description,
    });

    return res.status(200).json({
      success: true,
      data: {
        certificate_id: cert.certificate_id,
        student_name: cert.student_name_snapshot,
        course_title: cert.course_title_snapshot,
        issued_at: cert.issued_at,
        qr_code_image_base64: cert.qr_code_image.toString('base64'),
        credential_jwt: token,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listMine, download };
