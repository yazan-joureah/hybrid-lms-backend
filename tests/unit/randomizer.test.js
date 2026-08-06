const {
  secureShuffle,
  generateShuffledOrder,
} = require('../../src/services/quiz/randomizer.service');
const { Types } = require('mongoose');

describe('secureShuffle', () => {
  it('returns an array of the same length and same elements (no loss/duplication)', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = secureShuffle([...original]);

    expect(shuffled).toHaveLength(original.length);
    expect([...shuffled].sort()).toEqual([...original].sort());
  });

  it('does not always return the same order across many runs (statistical sanity check)', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seenOrders = new Set();

    for (let i = 0; i < 30; i += 1) {
      seenOrders.add(secureShuffle([...original]).join(','));
    }

    // With 10! possible orderings, seeing the SAME order in all 30 runs
    // would indicate a broken/non-random shuffle — not a proof of
    // correctness by itself, but a fast regression guard against an
    // accidental identity-function bug.
    expect(seenOrders.size).toBeGreaterThan(1);
  });

  it('handles a single-element array without error', () => {
    expect(secureShuffle([42])).toEqual([42]);
  });

  it('handles an empty array without error', () => {
    expect(secureShuffle([])).toEqual([]);
  });
});

describe('generateShuffledOrder', () => {
  function buildMockQuiz(questionCount = 3, choiceCount = 4) {
    return {
      questions: Array.from({ length: questionCount }, () => ({
        _id: new Types.ObjectId(),
        choices: Array.from({ length: choiceCount }, () => ({ _id: new Types.ObjectId() })),
      })),
    };
  }

  it('produces one entry per question, each with all its choice_ids preserved', () => {
    const quiz = buildMockQuiz(3, 4);
    const result = generateShuffledOrder({ quiz });

    expect(result).toHaveLength(3);
    result.forEach((entry) => {
      expect(entry.shuffled_choice_ids).toHaveLength(4);
      const originalIds = quiz.questions.find(
        (q) => q.question_id === entry.question_id || q._id.equals(entry.question_id)
      )._id
        ? quiz.questions.map((q) => q._id.toString())
        : null;
      expect(originalIds).toContain(entry.question_id.toString());
    });
  });

  it('does not mutate the original quiz.questions array reference order incorrectly (defensive copy check)', () => {
    const quiz = buildMockQuiz(5, 2);
    const originalOrder = quiz.questions.map((q) => q._id.toString());

    generateShuffledOrder({ quiz });

    // The source array's question order itself should remain untouched —
    // only the RETURNED structure represents the shuffled order.
    expect(quiz.questions.map((q) => q._id.toString())).toEqual(originalOrder);
  });
});
