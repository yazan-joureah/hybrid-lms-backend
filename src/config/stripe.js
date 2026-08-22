// src/config/stripe.js
/**
 * Stripe SDK initialization — Test Mode (free, sandbox test cards).
 * Reference: https://docs.stripe.com/keys
 */
const Stripe = require('stripe');
const env = require('./env');

const stripe = new Stripe(env.stripe.secretKey, {
  apiVersion: '2024-06-20',
});

module.exports = stripe;
