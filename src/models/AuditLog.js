const mongoose = require('mongoose');
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');
const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actor_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actor_role: {
      type: String,
      enum: ['Student', 'Instructor', 'Admin', 'SuperAdmin', 'System'],
      required: true,
    },
    action: { type: String, required: true },
    resource_type: { type: String, required: true },
    resource_id: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'audit_logs',
  }
);

auditLogSchema.index({ actor_id: 1 });
auditLogSchema.index({ resource_type: 1, resource_id: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ created_at: -1 });

applyReferentialIntegrity(auditLogSchema, [{ path: 'actor_id', ref: 'User', required: false }]);

module.exports = mongoose.model('AuditLog', auditLogSchema);
