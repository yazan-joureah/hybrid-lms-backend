// src/services/pay/idempotency.service.js

const { AppError } = require('../../middleware/errorHandler');

/** Deterministic key for a payment attempt — one active attempt per (student, course). */
function buildPaymentIdempotencyKey({ studentId, courseId }) {
  return `${studentId.toString()}:${courseId.toString()}`;
}

/** Deterministic key for a refund request — one active request per payment. */
function buildRefundIdempotencyKey({ paymentId }) {
  return `refund:${paymentId.toString()}`;
}

/**
 * Attempts an atomic insert. On success, returns the newly created document.
 * On a duplicate-key collision (E11000), fetches and returns the EXISTING
 * document instead.
 *
 * @param {import('mongoose').Model} Model
 * @param {object} docData - full document to attempt inserting
 * @param {object} findQuery - query to retrieve the pre-existing doc on conflict
 */
async function atomicInsertOrFetch({ Model, docData, findQuery }) {
  try {
    const created = await Model.create(docData);
    return { created: true, record: created };
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    const existing = await Model.findOne(findQuery);
    if (!existing) {
      throw new AppError(
        500,
        'IDEMPOTENCY_CONFLICT_UNRESOLVED',
        'Could not resolve a duplicate request.'
      );
    }
    return { created: false, record: existing };
  }
}

module.exports = { buildPaymentIdempotencyKey, buildRefundIdempotencyKey, atomicInsertOrFetch };
