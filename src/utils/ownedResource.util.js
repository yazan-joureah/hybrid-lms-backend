// src/utils/ownedResource.util.js

const { AppError } = require('../middleware/errorHandler');
const auditService = require('../services/auditService');

async function loadOwnedResource({
  model,
  resourceId,
  actorId,
  ownerField,
  resourceType,
  notFoundCode,
  notFoundMessage,
  forbiddenMessage = 'You do not have permission to modify this resource.',
  unauthorizedAction = null,
  auditMetadata = {},
  actorRole = 'Instructor',
  req = null,
}) {
  const resource = await model.findById(resourceId);
  if (!resource) {
    throw new AppError(404, notFoundCode, notFoundMessage);
  }

  const ownerValue = resource[ownerField];
  if (!ownerValue || ownerValue.toString() !== actorId.toString()) {
    if (unauthorizedAction) {
      await auditService.record({
        actorId,
        actorRole,
        action: unauthorizedAction,
        resourceType,
        resourceId: resourceId.toString(),
        metadata: { target_owner: ownerValue, ...auditMetadata },
        req,
      });
    }
    throw new AppError(403, 'FORBIDDEN', forbiddenMessage);
  }

  return resource;
}

module.exports = { loadOwnedResource };
