const quizController = require('./quiz/quiz.controller');
const quizSessionController = require('./quiz/quizSession.controller');
const quizQueryController = require('./quiz/quizQuery.controller');

module.exports = {
  ...quizController,
  ...quizSessionController,
  ...quizQueryController,
};
