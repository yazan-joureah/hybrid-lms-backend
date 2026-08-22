// src/models/certificateTemplate.model.js

const mongoose = require('mongoose');

const certificateTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    layout_key: { type: String, required: true },
    is_active: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'certificate_templates',
  }
);

module.exports = mongoose.model('CertificateTemplate', certificateTemplateSchema);
