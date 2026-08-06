// src/services/quiz/sanitize.service.js
/**
 * this is the ONLY function permitted to shape a Quiz document for a
 * student-facing response. It strips is_correct from every choice, and
 * reorders questions/choices according to this attempt's own
 * shuffled_question_order — the student never sees the raw, unshuffled
 * quiz.questions array. Every controller path that returns a quiz to a
 * student MUST call this before res.json(), never quiz.toObject() directly.
 */
function sanitizeQuizForStudent({ quiz, shuffledOrder }) {
  const questionsById = new Map(quiz.questions.map((q) => [q._id.toString(), q]));

  const orderedQuestions = shuffledOrder.map((entry) => {
    const question = questionsById.get(entry.question_id.toString());
    const choicesById = new Map(question.choices.map((c) => [c._id.toString(), c]));

    const orderedChoices = entry.shuffled_choice_ids.map((choiceId) => {
      const choice = choicesById.get(choiceId.toString());
      return { _id: choice._id, text: choice.text };
    });

    return {
      _id: question._id,
      question_type: question.question_type,
      text: question.text,
      choices: orderedChoices,
    };
  });

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

module.exports = { sanitizeQuizForStudent };
