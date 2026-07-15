// Reusable Mongoose plugin — enforces Foreign-Key-like existence checks
// at the application layer, since MongoDB has no native FK constraints.
// Mirrors the FK relationships that will appear in the ERD (regular
// relational-style diagram) for the final report.

const mongoose = require('mongoose');

/**
 * @param {mongoose.Schema} schema
 * @param {{path: string, ref: string, required?: boolean}[]} refFields
 */
function applyReferentialIntegrity(schema, refFields) {
  schema.pre('save', async function preSaveCheck(next) {
    for (const field of refFields) {
      const value = this[field.path];

      if (value == null) {
        if (field.required) {
          return next(new Error(`REFERENTIAL_INTEGRITY: ${field.path} is required`));
        }
        continue; // optional and unset — nothing to check
      }

      // Skip re-checking a reference that hasn't changed since the last
      // save (avoids an extra DB round trip on every unrelated update).
      if (!this.isNew && !this.isModified(field.path)) continue;

      // eslint-disable-next-line no-await-in-loop -- sequential is fine, refFields is always tiny (1-2 entries)
      const exists = await mongoose.model(field.ref).exists({ _id: value });
      if (!exists) {
        return next(
          new Error(
            `REFERENTIAL_INTEGRITY: ${field.path} references a non-existent ${field.ref} (${value})`
          )
        );
      }
    }
    return next();
  });
}

module.exports = { applyReferentialIntegrity };
