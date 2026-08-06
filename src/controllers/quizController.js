// src/controllers/quizController.js
const quizController = require('./quiz/quiz.controller');
const quizSessionController = require('./quiz/quizSession.controller');

module.exports = {
  ...quizController,
  ...quizSessionController,
};
