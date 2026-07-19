// Reusable Mongoose plugin — enforces Foreign-Key-like existence checks
// at the application layer, since MongoDB has no native FK constraints.
// Mirrors the FK relationships that will appear in the ERD (regular
// relational-style diagram) for the final report.

const mongoose = require('mongoose');

function applyReferentialIntegrity(schema, refFields) {
  schema.pre('save', async function preSaveCheck(next) {
    for (const field of refFields) {
      const value = this[field.path];

      if (value == null) {
        if (field.required) {
          return next(new Error(`REFERENTIAL_INTEGRITY: ${field.path} is required`));
        }
        continue;
      }

      if (!this.isNew && !this.isModified(field.path)) continue;

      // Determine if the field is an array
      const schemaPath = schema.paths[field.path];
      const isArray = schemaPath && schemaPath.instance === 'Array';

      if (isArray) {
        if (!Array.isArray(value)) {
          return next(new Error(`REFERENTIAL_INTEGRITY: ${field.path} must be an array`));
        }
        // Check each element
        for (const item of value) {
          if (item == null) {
            return next(
              new Error(`REFERENTIAL_INTEGRITY: ${field.path} contains null/undefined reference`)
            );
          }
          const exists = await mongoose.model(field.ref).exists({ _id: item });
          if (!exists) {
            return next(
              new Error(
                `REFERENTIAL_INTEGRITY: ${field.path} references a non-existent ${field.ref} (${item})`
              )
            );
          }
        }
      } else {
        // Single reference
        const exists = await mongoose.model(field.ref).exists({ _id: value });
        if (!exists) {
          return next(
            new Error(
              `REFERENTIAL_INTEGRITY: ${field.path} references a non-existent ${field.ref} (${value})`
            )
          );
        }
      }
    }
    return next();
  });
}

module.exports = { applyReferentialIntegrity };
