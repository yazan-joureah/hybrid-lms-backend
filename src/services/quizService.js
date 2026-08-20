const quizCoreService = require('./quiz/quiz.service');
const sessionService = require('./quiz/quizSession.service');
const presentationService = require('./quiz/quizPresentation.service');

module.exports = {
  ...quizCoreService,
  ...presentationService,
  ...sessionService,
};
