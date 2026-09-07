/**
 * The bank against the platform it belongs to.
 *
 * PairPath had three exercises tagged `arrays`, `loops`, `conditions`,
 * `modulo`, `indexing`, `bounds` and `logic` - free text matching nothing in
 * any other component. A pair could hit an off-by-one, Code Coach could report
 * `loop_boundaries`, Study Guider could offer the loop-boundaries lesson, and
 * nothing joined the exercise to either.
 *
 * Nothing enforced that, because there is nothing to enforce it against at
 * runtime: a wrong tag is a string that retrieves nothing and joins to
 * nothing, and every request still succeeds. These tests are the enforcement.
 */

import {
  PLATFORM_CONCEPT_TAGS,
  QUESTIONS,
  TOPICS,
  type BankQuestion,
} from '../../content/question-bank';

/** Code Coach's fifteen error types, from knowledge_base/code_coach_errors.json. */
const CODE_COACH_ERROR_TYPES = [
  'OFF_BY_ONE_LOOP_BOUNDARY',
  'INCORRECT_CONDITIONAL_OPERATOR',
  'ARRAY_LENGTH_INDEX_MISUSE',
  'STRING_EQUALITY_WITH_OPERATOR',
  'LOOP_UPDATE_WRONG_DIRECTION',
  'UNREACHABLE_CODE_AFTER_RETURN',
  'MISSING_BREAK_IN_SWITCH',
  'EMPTY_CONDITIONAL_BODY',
  'SELF_ASSIGNMENT',
  'ALWAYS_TRUE_OR_CONDITION',
  'IGNORED_STRING_METHOD_RESULT',
  'DIVISION_BY_ZERO_LITERAL',
  'CONSTANT_FALSE_LOOP_CONDITION',
  'DUPLICATE_IF_ELSE_CONDITION',
  'WHILE_VARIABLE_NOT_UPDATED',
];

const tagsUsed = new Set(QUESTIONS.flatMap((q) => q.conceptTags));
const errorsUsed = new Set(QUESTIONS.flatMap((q) => q.invitesErrors));

describe('coverage', () => {
  it('has an exercise for every platform concept tag', () => {
    // A concept with a lesson, a game and a detector but no exercise is a
    // concept a pair can be told about and never meet.
    const uncovered = PLATFORM_CONCEPT_TAGS.filter((tag) => !tagsUsed.has(tag));
    expect(uncovered).toEqual([]);
  });

  it('uses no tag outside the platform taxonomy', () => {
    // The failure that started this: `modulo` and `bounds` are reasonable
    // words and join to nothing.
    const stray = [...tagsUsed].filter(
      (tag) => !(PLATFORM_CONCEPT_TAGS as readonly string[]).includes(tag),
    );
    expect(stray).toEqual([]);
  });

  it('reaches every error type Code Coach can detect', () => {
    const unreachable = CODE_COACH_ERROR_TYPES.filter((type) => !errorsUsed.has(type));
    expect(unreachable).toEqual([]);
  });

  it('names no error type Code Coach does not have', () => {
    const invented = [...errorsUsed].filter((type) => !CODE_COACH_ERROR_TYPES.includes(type));
    expect(invented).toEqual([]);
  });

  it('gives every topic more than one exercise', () => {
    // The complaint that started this was a topic dropdown with one question
    // in it, which makes the choice pointless.
    for (const topic of TOPICS) {
      const count = QUESTIONS.filter((q) => q.topicId === topic.id).length;
      expect({ topic: topic.name, count }).toMatchObject({ count: expect.any(Number) });
      expect(count).toBeGreaterThan(1);
    }
  });
});

describe('every question is well formed', () => {
  const each = (assertion: (q: BankQuestion) => void) => () => QUESTIONS.forEach(assertion);

  it('has a unique id', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });

  it('belongs to a topic that exists', each((q) => {
    expect(TOPICS.map((t) => t.id)).toContain(q.topicId);
  }));

  it('carries at least one concept tag', each((q) => {
    expect(q.conceptTags.length).toBeGreaterThan(0);
  }));

  it('has starter code that does not contain the answer', each((q) => {
    // The starter is a scaffold with a TODO. If it already contained the
    // solution there would be nothing for the pair to do, and the reference
    // solution would be indistinguishable from it.
    expect(q.starterCode).toContain('TODO');
    expect(q.starterCode).not.toEqual(q.referenceSolution);
    expect(q.referenceSolution).not.toContain('TODO');
  }));

  it('declares a class name the code runner can find', each((q) => {
    // CodeRunnerService extracts the class with /(?:public\s+)?class\s+(\w+)/
    // and refuses the run without a match, so a question whose starter has no
    // class declaration cannot be run at all.
    for (const source of [q.starterCode, q.referenceSolution]) {
      expect(source).toMatch(/(?:public\s+)?class\s+[A-Za-z0-9_]+/);
    }
  }));

  it('uses the same class name in the starter and the solution', each((q) => {
    const nameOf = (s: string) => s.match(/class\s+([A-Za-z0-9_]+)/)?.[1];
    expect(nameOf(q.starterCode)).toBe(nameOf(q.referenceSolution));
  }));

  it('has a difficulty the UI can display', each((q) => {
    expect(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).toContain(q.difficulty);
  }));
});

describe('review prompts', () => {
  it('asks something of every question', () => {
    for (const question of QUESTIONS) {
      expect(question.reviewQuestions.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('is not the same filler on every question', () => {
    // Six of the ten prompts used to be identical across all three questions -
    // "Did we follow Java coding conventions?", "Did we add comments where
    // necessary?" - which is a form the pair learns to skim.
    const counts = new Map<string, number>();
    for (const question of QUESTIONS) {
      for (const { prompt } of question.reviewQuestions) {
        counts.set(prompt, (counts.get(prompt) ?? 0) + 1);
      }
    }

    const repeated = [...counts.entries()].filter(([, n]) => n > 1);
    expect(repeated).toEqual([]);
  });

  it('cannot be answered correctly by agreeing with everything', () => {
    // The whole reason `expected` exists. Scored as the count of yes answers
    // against all-positive prompts, a student who ticked every box scored full
    // marks - so the instrument measured agreeableness.
    for (const question of QUESTIONS) {
      const expectations = question.reviewQuestions.map((p) => p.expected);
      expect(expectations).toContain(true);
      expect(expectations).toContain(false);
    }
  });

  it('asks about the session, not only about the code', () => {
    // A peer review of pair programming that never mentions the pair is a
    // self-assessment of the code with extra steps.
    const collaborative = /\b(we|us|partner|navigator|driver|each other|together|one of us)\b/i;
    for (const question of QUESTIONS) {
      const asksAboutThePair = question.reviewQuestions.some((p) =>
        collaborative.test(p.prompt),
      );
      expect({ id: question.id, asksAboutThePair }).toMatchObject({ asksAboutThePair: true });
    }
  });
});
