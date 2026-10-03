/**
 * The review model's prompt, and the checks on what comes back.
 *
 * The quiz scores students, so it is held to strict rules. The sections shown
 * after it - strengths, the path to the solution, a suggested exercise - are
 * checked item by item: a line range must be in the pair's own code, an
 * improvement must describe a change rather than paste a program, and a
 * suggested exercise must be one the bank actually offers.
 */

import {
  ReviewError,
  ReviewRequest,
  buildPrompt,
  fallbackSuggestion,
  lineRange,
  parseJson,
  validateReview,
} from './review-writer';
import { geminiText, openaiText } from './llm.service';

const CODE = [
  'public class Main {',
  '    public static void main(String[] args) {',
  '        for (int i = 1; i < 5; i++) {',
  '            System.out.println(i);',
  '        }',
  '    }',
  '}',
].join('\n');

function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    mode: 'pair',
    exercise: {
      title: 'Count to Five',
      description: 'Print 1 to 5.',
      difficulty: 'BEGINNER',
      concept_tags: ['loop_boundaries'],
      expected_output: '1\n2\n3\n4\n5',
      reference_solution: 'MODEL-SOLUTION-TEXT for (int i = 1; i <= 5; i++)',
    },
    code: CODE,
    outcome: 'unsolved',
    runs: { total: 2, correct: 0, failed: 0 },
    teamwork: null,
    code_concepts: [],
    suggestions: [],
    ...overrides,
  };
}

const FREE = (overrides: Partial<ReviewRequest> = {}) =>
  request({
    exercise: null,
    outcome: 'free',
    code_concepts: ['loop_boundaries'],
    suggestions: [
      { id: 'q-easy', title: 'Count to Five', difficulty: 'BEGINNER', concept_tags: ['loop_boundaries'] },
      { id: 'q-hard', title: 'Countdown', difficulty: 'INTERMEDIATE', concept_tags: ['loop_boundaries'] },
    ],
    ...overrides,
  });

const step = (answer = 1) => ({
  teach: 'The loop stops when `i < 5` is false.',
  lines: [3, 3],
  question: { prompt: 'What is printed last?', options: ['4', '5', '6'], answer, explanation: '`i < 5` stops at 4.' },
});

function answer(overrides: Record<string, unknown> = {}) {
  return {
    title: 'One number short',
    summary: 'You were one change away.',
    steps: [step(1), step(0), step(2)],
    reflection: [{ prompt: 'Who ran it?', options: ['Driver', 'Navigator', 'Both'] }],
    strengths: ['You printed inside the loop body, which is exactly right.'],
    improvements: [
      {
        lines: [3, 3],
        change: 'Change `i < 5` to `i <= 5`.',
        why: '`i < 5` stops before 5.',
        achieves: 'With `i <= 5` your loop would have printed all five numbers.',
      },
    ],
    nextStep: 'Practise loop boundaries.',
    solutionNote: 'The model solution uses `<=`.',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('gives the model the solution for an exercise, and frames an unsolved one as a path', () => {
    const prompt = buildPrompt(request());
    expect(prompt).toContain('MODEL-SOLUTION-TEXT');
    expect(prompt).toContain('PATH TO THE SOLUTION');
    expect(prompt).toContain('you were two changes away');
    expect(prompt).toContain('3 |         for (int i = 1; i < 5; i++) {');
  });

  it('frames a solved exercise as two ways to the same answer', () => {
    expect(buildPrompt(request({ outcome: 'solved' }))).toContain('TWO WAYS TO THE SAME ANSWER');
  });

  it('has no solution and lists real exercises for a free session', () => {
    const prompt = buildPrompt(FREE());
    expect(prompt).not.toContain('MODEL SOLUTION');
    expect(prompt).toContain('FREE CODING');
    expect(prompt).toContain('id: q-easy | Count to Five');
    expect(prompt).toContain('"suggestedExerciseId"');
    expect(prompt).not.toContain('"solutionNote"');
  });
});

describe('validateReview', () => {
  it('keeps a review that holds together', () => {
    const review = validateReview(answer(), request());
    expect(review.steps).toHaveLength(3);
    expect(review.strengths).toHaveLength(1);
    expect(review.improvements[0]).toMatchObject({ lines: [3, 3], change: 'Change `i < 5` to `i <= 5`.' });
    expect(review.solutionNote).toMatch(/<=/);
    expect(review.suggestion).toBeNull();
  });

  it('refuses a question whose answer points past its options', () => {
    expect(() => validateReview(answer({ steps: [step(1), step(0), step(7)] }), request())).toThrow(ReviewError);
  });

  it('refuses a review with no strengths, or no improvement that holds together', () => {
    expect(() => validateReview(answer({ strengths: [] }), request())).toThrow('no strengths');
    expect(() => validateReview(answer({ improvements: [{ change: 'x' }] }), request())).toThrow('no improvements');
  });

  it('drops an improvement that pastes a program instead of describing a change', () => {
    const pasted = {
      lines: [1, 7],
      change: 'Use this: public class Main { public static void main(String[] a) {} }',
      why: 'It works.',
      achieves: 'It would work.',
    };
    const review = validateReview(answer({ improvements: [pasted, answer().improvements[0]] }), request());
    expect(review.improvements).toHaveLength(1);
    expect(review.improvements[0].change).toContain('<= 5');
  });

  it('keeps an improvement whose lines are outside the code, without the highlight', () => {
    const outside = { ...answer().improvements[0], lines: [40, 42] };
    expect(validateReview(answer({ improvements: [outside] }), request()).improvements[0].lines).toBeNull();
  });

  it('keeps two improvements at most for a free session, and only a suggestion from the list', () => {
    const three = [1, 2, 3].map((n) => ({ ...answer().improvements[0], change: `Change ${n}.` }));
    const picked = validateReview(
      answer({ improvements: three, suggestedExerciseId: 'q-hard', suggestionReason: 'Loops again.' }),
      FREE(),
    );
    expect(picked.improvements).toHaveLength(2);
    expect(picked.solutionNote).toBeNull();
    expect(picked.suggestion).toEqual({ questionId: 'q-hard', title: 'Countdown', reason: 'Loops again.' });

    const invented = validateReview(
      answer({ suggestedExerciseId: 'not-in-the-bank', suggestionReason: 'Try it.' }),
      FREE(),
    );
    expect(invented.suggestion?.questionId).toBe('q-easy');
  });

  it('drops the teamwork questions for a student who worked alone', () => {
    expect(validateReview(answer(), request({ mode: 'solo' })).reflection).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads JSON wrapped in a code fence or surrounded by prose', () => {
    expect(parseJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here it is: {"a": 2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJson('no json here')).toThrow(ReviewError);
  });

  it('orders a backwards line range and clamps one that runs off the end', () => {
    expect(lineRange([5, 3], 7)).toEqual([3, 5]);
    expect(lineRange([6, 99], 7)).toEqual([6, 7]);
    expect(lineRange([0, 2], 7)).toBeNull();
    expect(lineRange('3-5', 7)).toBeNull();
  });

  it('suggests nothing when the bank offers nothing', () => {
    expect(fallbackSuggestion([])).toBeNull();
  });

  it('reads the answer out of a thinking Gemini response, skipping the thoughts', () => {
    const data = {
      candidates: [
        { content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"ok":', thoughtSignature: 'x' }, { text: 'true}' }] } },
      ],
    };
    expect(geminiText(data)).toBe('{"ok":true}');
  });

  it('reads the answer out of an OpenAI Responses body', () => {
    const data = {
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] },
      ],
    };
    expect(openaiText(data)).toBe('{"ok":true}');
  });
});
