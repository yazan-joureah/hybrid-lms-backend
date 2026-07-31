// src/services/pay/webhookSecurity.service.js
/**
 * SF-PAY-03: verifies Stripe webhook signature + timestamp window.
 */
const stripe = require('../../config/stripe');
const env = require('../../config/env');
const { AppError } = require('../../middleware/errorHandler');

/**
 * @param {object} params
 * @param {Buffer} params.rawBody - the UNPARSED request body (express.raw())
 * @param {string} params.signatureHeader - the 'stripe-signature' header value
 * @returns {import('stripe').Stripe.Event}
 */
function verifyWebhookSignature({ rawBody, signatureHeader }) {
  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, env.stripe.webhookSecret);
  } catch (err) {
    throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }
}

module.exports = { verifyWebhookSignature };
