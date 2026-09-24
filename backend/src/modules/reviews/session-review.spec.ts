/**
 * The rules about a review as data: what holds together, and how a session's
 * runs and events are summarised for the model.
 */

import { modeOf, readContent, runsOf, scoredCountOf, teamworkOf } from './session-review';

const step = (answer: unknown, options: unknown = ['a', 'b', 'c']) => ({
  teach: 'Teach.',
  lines: [2, 1],
  question: { prompt: 'Ask?', options, answer, explanation: 'Why.' },
});

describe('readContent', () => {
  it('keeps a review that holds together, and drops a backwards line range', () => {
    const content = readContent({ title: 'T', steps: [step(2)], reflection: [] })!;
    expect(content.steps[0].question.answer).toBe(2);
    expect(content.steps[0].lines).toBeNull();
  });

  it.each([
    ['an answer past the options', step(3)],
    ['a boolean answer', step(true)],
    ['a single option', step(0, ['only'])],
  ])('refuses %s, because it would mark a right answer wrong', (_name, bad) => {
    expect(readContent({ title: 'T', steps: [bad] })).toBeNull();
  });

  it('drops a malformed teamwork question without losing the review', () => {
    const content = readContent({ title: 'T', steps: [step(0)], reflection: [{ prompt: '?' }] })!;
    expect(content.reflection).toEqual([]);
  });
});

describe('scoredCountOf', () => {
  it('counts the written questions, and the fixed prompts when there is no written review', () => {
    expect(scoredCountOf({ title: 'T', steps: [step(0), step(1)] }, ['x'])).toBe(2);
    expect(scoredCountOf(null, ['x', 'y', 'z'])).toBe(3);
  });
});

describe('modeOf', () => {
  it('is a pair once a second student joined', () => {
    expect(modeOf([{ userId: 'a' }])).toBe('solo');
    expect(modeOf([{ userId: 'a' }, { userId: 'b' }])).toBe('pair');
  });
});

describe('runsOf', () => {
  const run = (fields: object) => ({ metadata: JSON.stringify(fields) });

  it('is solved when any graded run was right', () => {
    const result = runsOf([run({ success: true, correct: false }), run({ success: true, correct: true })], true);
    expect(result).toEqual({ outcome: 'solved', runs: { total: 2, correct: 1, failed: 0 } });
  });

  it('is unsolved when graded runs were all wrong, counting crashes', () => {
    const result = runsOf([run({ success: false, correct: null }), run({ success: true, correct: false })], true);
    expect(result).toEqual({ outcome: 'unsolved', runs: { total: 2, correct: 0, failed: 1 } });
  });

  it('is ungraded with nothing to compare against, or no runs', () => {
    expect(runsOf([run({ success: true, correct: null })], false).outcome).toBe('ungraded');
    expect(runsOf([], true).outcome).toBe('ungraded');
  });
});

describe('teamworkOf', () => {
  it('counts by role and finds how lopsided the typing was', () => {
    const team = teamworkOf(
      [
        { userId: 'a', role: 'DRIVER', eventType: 'CODE_EDIT', count: 9 },
        { userId: 'b', role: 'DRIVER', eventType: 'CODE_EDIT', count: 1 },
        { userId: 'b', role: 'NAVIGATOR', eventType: 'CODE_RUN', count: 2 },
        { userId: 'a', role: 'DRIVER', eventType: 'ROLE_SWITCH', count: 1 },
      ],
      new Date('2026-01-01T10:00:00Z'),
      new Date('2026-01-01T10:12:00Z'),
    );

    expect(team).toEqual({
      duration_minutes: 12,
      role_switches: 1,
      edits_by_driver: 10,
      edits_by_navigator: 0,
      runs_by_driver: 0,
      runs_by_navigator: 2,
      chat_messages: 0,
      busiest_partner_edit_percent: 90,
    });
  });
});
