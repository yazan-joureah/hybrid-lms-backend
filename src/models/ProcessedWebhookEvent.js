// src/models/ProcessedWebhookEvent.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const processedWebhookEventSchema = new Schema(
  {
    event_id: { type: String, required: true, unique: true },
    event_type: { type: String, required: true },
  },
  { timestamps: true, collection: 'processed_webhook_events' }
);

module.exports = mongoose.model('ProcessedWebhookEvent', processedWebhookEventSchema);
