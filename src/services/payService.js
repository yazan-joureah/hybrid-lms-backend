// src/services/payService.js
const eligibilityService = require('./pay/eligibility.service');
const paymentService = require('./pay/payment.service');
const webhookSecurityService = require('./pay/webhookSecurity.service');
const webhookService = require('./pay/webhook.service');
const invoiceService = require('./pay/invoice.service');
const refundService = require('./pay/refund.service');
const payQuery = require('./pay/payQuery.service');

module.exports = {
  ...eligibilityService,
  ...paymentService,
  ...webhookSecurityService,
  ...webhookService,
  ...invoiceService,
  ...refundService,
  ...payQuery,
};
