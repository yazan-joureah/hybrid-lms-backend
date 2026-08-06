const eligibilityService = require('./quiz/eligibility.service');
const randomizerService = require('./quiz/randomizer.service');
const quizCoreService = require('./quiz/quiz.service');
module.exports = {
  ...eligibilityService,
  ...randomizerService,
  ...quizCoreService,
};
