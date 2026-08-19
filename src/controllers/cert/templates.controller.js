// src/controllers/cert/templates.controller.js
// UC-CERT-06 — Manage Certificate Templates (SuperAdmin)
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require('../../services/cert/certificate.service');

async function list(req, res, next) {
  try {
    const result = await listTemplates();
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const result = await createTemplate({
      adminId: req.user.id,
      templateData: req.body,
      req,
    });
    return res.status(201).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const result = await updateTemplate({
      adminId: req.user.id,
      templateId: req.params.templateId,
      updateData: req.body,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await deleteTemplate({ adminId: req.user.id, templateId: req.params.templateId, req });
    return res.status(200).json({ success: true, message: 'Template deleted.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, create, update, remove };
