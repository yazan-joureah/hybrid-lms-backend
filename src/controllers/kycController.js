// Thin controller layer — mirrors authController.js: no business logic
// here, only request parsing + calling the service layer + shaping the
// HTTP response.

const KYCRequest = require('../models/KYCRequest');
const KYCDocument = require('../models/KYCDocument');
const { decryptForUser } = require('../utils/crypto');
const { submitKycRequest } = require('../services/kyc/kycSubmission.service');
const {
  getRequestForReview,
  approveKycRequest,
  rejectKycRequest,
} = require('../services/kyc/kycReview.service');
const { ApiError } = require('../middleware/errorHandler');

async function submit(req, res, next) {
  try {
    const idFile = req.files?.id_document?.[0];
    const selfieFile = req.files?.selfie?.[0];

    if (!idFile || !selfieFile) {
      throw new ApiError(400, 'MISSING_FILES', 'Both id_document and selfie files are required.');
    }

    const result = await submitKycRequest({
      userId: req.user.id,
      idDocumentType: req.validatedBody.idDocumentType,
      idDocumentFile: { buffer: idFile.buffer, filename: idFile.originalname },
      selfieFile: { buffer: selfieFile.buffer, filename: selfieFile.originalname },
      req,
    });

    if (!result.success) {
      throw new ApiError(400, result.reason, 'Your KYC submission could not be processed.');
    }

    return res
      .status(201)
      .json({ success: true, data: { message: 'KYC request submitted for review.' } });
  } catch (err) {
    return next(err);
  }
}

async function listPending(req, res, next) {
  try {
    const requests = await KYCRequest.find({ status: 'review_pending' })
      .sort({ submitted_at: 1 })
      .populate('user_id', 'full_name email role')
      .lean();

    return res.status(200).json({ success: true, data: { requests } });
  } catch (err) {
    return next(err);
  }
}

async function getDetail(req, res, next) {
  try {
    const context = await getRequestForReview(req.params.id);
    if (!context) {
      throw new ApiError(404, 'REQUEST_NOT_FOUND', 'KYC request not found or not pending review.');
    }

    const { kycRequest, applicant } = context;
    return res.status(200).json({
      success: true,
      data: {
        id: kycRequest._id,
        applicant: {
          id: applicant._id,
          full_name: applicant.full_name,
          email: applicant.email,
          role: applicant.role,
          birth_date: applicant.birth_date,
        },
        applicant_role: kycRequest.applicant_role,
        submitted_at: kycRequest.submitted_at,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// Streams a decrypted document image. Ownership is checked via the
// KYCRequest's own document references — never trust a raw file_reference
// passed directly by the client (prevents IDOR across unrelated requests).
async function getDocumentImage(req, res, next) {
  try {
    const { id, documentType } = req.params;
    if (!['id_document', 'selfie'].includes(documentType)) {
      throw new ApiError(
        400,
        'INVALID_DOCUMENT_TYPE',
        'documentType must be id_document or selfie.'
      );
    }

    const kycRequest = await KYCRequest.findById(id);
    if (!kycRequest) {
      throw new ApiError(404, 'REQUEST_NOT_FOUND', 'KYC request not found.');
    }

    const fileReference =
      documentType === 'id_document'
        ? kycRequest.id_document_reference
        : kycRequest.selfie_reference;

    const document = await KYCDocument.findOne({ file_reference: fileReference });
    if (!document) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    }

    // Decryption key is derived from the APPLICANT's user_id (who owns the
    // document), never the reviewing admin's id.
    const decrypted = decryptForUser(document.encrypted_content, document.user_id);

    res.setHeader('Content-Type', document.detected_mime_type);
    res.setHeader('Cache-Control', 'no-store'); // never cache sensitive KYC imagery
    return res.status(200).send(decrypted);
  } catch (err) {
    return next(err);
  }
}

async function approve(req, res, next) {
  try {
    const result = await approveKycRequest({
      kycRequestId: req.params.id,
      adminUserId: req.user.id,
      documentBirthDate: new Date(req.validatedBody.documentBirthDate),
      optionalNote: req.validatedBody.optionalNote,
      req,
    });

    if (!result.success) {
      throw new ApiError(400, result.reason, 'Could not process the approval.');
    }

    return res.status(200).json({ success: true, data: { outcome: result.outcome } });
  } catch (err) {
    return next(err);
  }
}

async function reject(req, res, next) {
  try {
    const result = await rejectKycRequest({
      kycRequestId: req.params.id,
      adminUserId: req.user.id,
      rejectionReason: req.validatedBody.rejectionReason,
      req,
    });

    if (!result.success) {
      throw new ApiError(400, result.reason, 'Could not process the rejection.');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    return next(err);
  }
}

module.exports = { submit, listPending, getDetail, getDocumentImage, approve, reject };
