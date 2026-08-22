// src/models/Invoice.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const invoiceSchema = new Schema(
  {
    payment_id: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    invoice_number: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    issued_at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: 'invoices' }
);

applyReferentialIntegrity(invoiceSchema, [
  { path: 'payment_id', ref: 'Payment', required: true },
  { path: 'student_id', ref: 'User', required: true },
  { path: 'course_id', ref: 'Course', required: true },
]);

module.exports = mongoose.model('Invoice', invoiceSchema);
