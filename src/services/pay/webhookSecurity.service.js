// src/services/pay/webhookSecurity.service.js

const stripe = require('../../config/stripe');
const env = require('../../config/env');
const { AppError } = require('../../middleware/errorHandler');

function verifyWebhookSignature({ rawBody, signatureHeader }) {
  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, env.stripe.webhookSecret);
  } catch (err) {
    throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }
}

module.exports = { verifyWebhookSignature };
