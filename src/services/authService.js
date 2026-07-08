/**
 * AUTH module — Public Facade.
 *
 * REFACTOR NOTE (see Refactor phase discussion): this file used to contain
 * all 642 lines of AUTH business logic directly. It has been split into
 * three bounded-context modules under ./auth/ (registration, session,
 * password recovery), each independently focused per the Single
 * Responsibility Principle. This file now exists PURELY so that every
 * existing caller — authController.js, and any test that does
 * `require('../../src/services/authService')` — keeps working with ZERO
 * changes, per the Facade pattern. No business logic lives here anymore;
 * if you're looking for actual implementation, it's in ./auth/.
 */
const registrationService = require('./auth/registration.service');
const sessionService = require('./auth/session.service');
const passwordRecoveryService = require('./auth/passwordRecovery.service');

module.exports = {
  ...registrationService,
  ...sessionService,
  ...passwordRecoveryService,
};
