// src/services/quiz/quizPresentation.service.js
const crypto = require('crypto');

/**
 * Fisher–Yates (Durstenfeld).
 */
function secureShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// for each attempt
function generateShuffledOrder({ quiz }) {
  const shuffledQuestions = secureShuffle([...quiz.questions]);

  return shuffledQuestions.map((question) => ({
    question_id: question._id,
    shuffled_choice_ids: secureShuffle(question.choices.map((c) => c._id)),
  }));
}

// remove is_correct for students
function sanitizeQuizForStudent({ quiz, shuffledOrder }) {
  const questionsById = new Map(quiz.questions.map((q) => [q._id.toString(), q]));

  const orderedQuestions = shuffledOrder
    .map((entry) => {
      const question = questionsById.get(entry.question_id.toString());

      if (!question) return null;

      const choicesById = new Map(question.choices.map((c) => [c._id.toString(), c]));
      const orderedChoices = entry.shuffled_choice_ids
        .map((choiceId) => {
          const choice = choicesById.get(choiceId.toString());
          return choice ? { _id: choice._id, text: choice.text } : null;
        })
        .filter(Boolean);

      return {
        _id: question._id,
        question_type: question.question_type,
        text: question.text,
        choices: orderedChoices,
      };
    })
    .filter(Boolean);

  return {
    _id: quiz._id,
    title: quiz.title,
    description: quiz.description,
    quiz_type: quiz.quiz_type,
    duration_minutes: quiz.duration_minutes,
    passing_score_percent: quiz.passing_score_percent,
    allow_back_navigation: quiz.allow_back_navigation,
    questions: orderedQuestions,
  };
}

module.exports = { secureShuffle, generateShuffledOrder, sanitizeQuizForStudent };
