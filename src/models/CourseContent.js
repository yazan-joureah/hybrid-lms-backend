// src/models/CourseContent.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseContentSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    unit_id: { type: Schema.Types.ObjectId, ref: 'CourseUnit', required: true },
    owner_instructor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content_type: { type: String, enum: ['video', 'document', 'link', 'text'], required: true },

    storage_path: { type: String, default: null },
    mime_type: { type: String, default: null },
    size_bytes: { type: Number, default: null },
    magic_bytes_match: { type: Boolean, default: null },

    // link/text content has no file
    // Shape by content_type: { url: string } for 'link', { text: string } for 'text'.
    content_data: { type: Schema.Types.Mixed, default: null },

    order: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: 'course_contents',
  }
);

applyReferentialIntegrity(courseContentSchema, [
  { path: 'course_id', ref: 'Course', required: true },
  { path: 'unit_id', ref: 'CourseUnit', required: true },
  { path: 'owner_instructor_id', ref: 'User', required: true },
]);

module.exports = mongoose.model('CourseContent', courseContentSchema);
