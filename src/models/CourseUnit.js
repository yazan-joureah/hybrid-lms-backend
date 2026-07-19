const mongoose = require('mongoose');
const { Schema } = mongoose;
const { applyReferentialIntegrity } = require('../utils/referentialIntegrity.util');

const courseUnitSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true },
    order: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: 'course_units',
  }
);

applyReferentialIntegrity(courseUnitSchema, [{ path: 'course_id', ref: 'Course', required: true }]);

module.exports = mongoose.model('CourseUnit', courseUnitSchema);
