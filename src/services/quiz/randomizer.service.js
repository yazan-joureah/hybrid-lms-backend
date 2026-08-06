// src/services/quiz/randomizer.service.js
const crypto = require('crypto');

/**
 * Fisher–Yates (Durstenfeld variant) shuffle using crypto.randomInt — NOT
 * Math.random(), which is statistically predictable given enough samples.
 */
function secureShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    // eslint-disable-next-line security/detect-object-injection
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Builds the per-attempt shuffled question/choice order for a given quiz:
 * a unique question sequence AND a unique choice sequence within each
 * question, generated fresh for this attempt only.
 */
function generateShuffledOrder({ quiz }) {
  const shuffledQuestions = secureShuffle([...quiz.questions]);

  return shuffledQuestions.map((question) => ({
    question_id: question._id,
    shuffled_choice_ids: secureShuffle(question.choices.map((c) => c._id)),
  }));
}

module.exports = { generateShuffledOrder, secureShuffle };
