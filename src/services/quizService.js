const quizCoreService = require('./quiz/quiz.service');
const eligibilityService = require('./quiz/eligibility.service');
const randomizerService = require('./quiz/randomizer.service');
const sessionService = require('./quiz/quizSession.service');

module.exports = {
  ...quizCoreService,
  ...eligibilityService,
  ...randomizerService,
  ...sessionService,
};
