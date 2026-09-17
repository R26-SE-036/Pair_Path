/**
 * The outcome a finished session reports to Code Coach.
 *
 * What gets reported moves a student's mastery and can open a lesson, so the
 * cases that matter most here are the ones that must NOT count: a session
 * from before grading existed, an exercise with nothing to grade against, a
 * review nobody submitted.
 */

import { OutcomeInput, summariseOutcome } from './session-outcome';

const STARTED = new Date('2026-09-13T10:00:00.000Z');
const at = (seconds: number) => new Date(STARTED.getTime() + seconds * 1000);

function input(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return {
    session: {
      id: 's1',
      status: 'COMPLETED',
      questionId: 'q-loop-control-countdown',
      startedAt: STARTED,
      endedAt: at(600),
    },
    question: {
      title: 'Countdown',
      difficulty: 'BEGINNER',
      conceptTags: ['loop_control'],
      hasExpectedOutput: true,
    },
    runResults: [],
    myReview: null,
    promptCount: 5,
    bankErrorType: 'LOOP_UPDATE_WRONG_DIRECTION',
    ...overrides,
  };
}

/** A CODE_RUN_RESULT the way the gateway stores it: metadata as a JSON string. */
const stored = (seconds: number, metadata: Record<string, unknown>) => ({
  timestamp: at(seconds),
  metadata: JSON.stringify(metadata),
});

/** A run recorded since grading shipped. null is a program that did not compile. */
const ran = (seconds: number, correct: boolean | null) =>
  stored(seconds, { success: correct !== null, hasError: correct === null, correct });

describe('a session outcome', () => {
  it('counts the runs, and is solved from the first one that matched', () => {
    const outcome = summariseOutcome(
      input({ runResults: [ran(300, true), ran(60, false), ran(240, true)] }),
    );

    expect(outcome.runCount).toBe(3);
    expect(outcome.gradedRunCount).toBe(3);
    expect(outcome.correctRunCount).toBe(2);
    expect(outcome.solved).toBe(true);
    // The earliest correct run, even though the events arrived out of order.
    expect(outcome.secondsToSolve).toBe(240);
    expect(outcome.durationSeconds).toBe(600);
  });

  it('does not call a program that ran and printed the wrong thing solved', () => {
    // The Countdown case: compiles, runs, `success` is true, output is wrong.
    const outcome = summariseOutcome(input({ runResults: [ran(60, false)] }));

    expect(outcome.solved).toBe(false);
    expect(outcome.secondsToSolve).toBeNull();
  });

  it('counts a program that did not compile as an attempt that did not solve it', () => {
    const outcome = summariseOutcome(input({ runResults: [ran(60, null)] }));

    expect(outcome.gradedRunCount).toBe(1);
    expect(outcome.solved).toBe(false);
  });

  it('leaves a session from before grading unjudged rather than unsolved', () => {
    // No `correct` key at all. Reading that as wrong would report a struggle
    // for every session recorded before the check existed.
    const outcome = summariseOutcome(
      input({ runResults: [stored(60, { success: true, hasError: false })] }),
    );

    expect(outcome.runCount).toBe(1);
    expect(outcome.gradedRunCount).toBe(0);
    expect(outcome.solved).toBeNull();
  });

  it('leaves an exercise with nothing to grade against unjudged', () => {
    const outcome = summariseOutcome(
      input({
        question: { title: 'Open', difficulty: null, conceptTags: ['loop_control'], hasExpectedOutput: false },
        runResults: [ran(60, false)],
      }),
    );

    expect(outcome.solved).toBeNull();
  });

  it('leaves a session nobody ran anything in unjudged', () => {
    expect(summariseOutcome(input()).solved).toBeNull();
  });

  it('reads run metadata whether it arrives as a string or an object', () => {
    const outcome = summariseOutcome(
      input({
        runResults: [{ timestamp: at(90), metadata: { success: true, hasError: false, correct: true } }],
      }),
    );

    expect(outcome.solved).toBe(true);
  });

  it('scores the review against how many prompts the question has', () => {
    expect(summariseOutcome(input({ myReview: { score: 4 } })).reviewScorePercent).toBe(80);

    const unsubmitted = summariseOutcome(input());
    expect(unsubmitted.reviewSubmitted).toBe(false);
    expect(unsubmitted.reviewScorePercent).toBeNull();

    expect(summariseOutcome(input({ myReview: { score: 3 }, promptCount: 0 })).reviewScorePercent).toBeNull();
  });

  it('has no duration while the session is still running', () => {
    const outcome = summariseOutcome(
      input({ session: { ...input().session, status: 'ACTIVE', endedAt: null } }),
    );

    expect(outcome.endedAt).toBeNull();
    expect(outcome.durationSeconds).toBeNull();
  });

  it('keeps only real concept tags', () => {
    const mixed = summariseOutcome(
      input({
        question: { ...input().question!, conceptTags: ['loop_control', 3, '', null, 'loop_boundaries'] },
      }),
    );
    expect(mixed.conceptTags).toEqual(['loop_control', 'loop_boundaries']);

    const notAList = summariseOutcome(
      input({ question: { ...input().question!, conceptTags: 'loop_control' } }),
    );
    expect(notAList.conceptTags).toEqual([]);
  });

  it('never carries the expected output, or whether there was one', () => {
    // It leaves this service for the web app and then Code Coach. For most of
    // these exercises the expected output is the answer.
    const serialised = JSON.stringify(summariseOutcome(input({ runResults: [ran(60, true)] })));

    expect(serialised).not.toContain('xpectedOutput');
  });
});
