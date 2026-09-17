/**
 * Whether a nudge changed what the model saw next.
 *
 * The case these tests guard hardest is the easy mistake: reading a
 * prediction made a minute after a nudge as its effect, when two-thirds of
 * what that prediction saw happened before the nudge was shown.
 */

import { MIN_TO_COMPARE, NudgeInput, PredictionInput, measureNudges } from './nudge-effect';

const T0 = new Date('2026-09-13T10:00:00.000Z').getTime();
const at = (seconds: number) => new Date(T0 + seconds * 1000);

const nudge = (overrides: Partial<NudgeInput> = {}): NudgeInput => ({
  sessionId: 's1',
  state: 'DISENGAGED',
  action: 'RE_ENGAGEMENT_SUPPORT',
  shownAt: at(0),
  accepted: true,
  ...overrides,
});

const predicted = (seconds: number, predictedState: string, sessionId = 's1'): PredictionInput => ({
  sessionId,
  windowEnd: at(seconds),
  predictedState,
});

describe('measuring a nudge', () => {
  it('counts a problem state followed by PRODUCTIVE as recovered', () => {
    const effect = measureNudges([nudge()], [predicted(200, 'PRODUCTIVE')]);

    expect(effect.nudges[0].after).toBe('PRODUCTIVE');
    expect(effect.nudges[0].verdict).toBe('recovered');
  });

  it('ignores a prediction whose window still overlaps the nudge', () => {
    // At 60s the model is still reading 120s of pre-nudge activity. Scoring
    // that as the nudge's effect would credit it with behaviour it never saw.
    const effect = measureNudges(
      [nudge()],
      [predicted(60, 'PRODUCTIVE'), predicted(200, 'DISENGAGED')],
    );

    expect(effect.nudges[0].after).toBe('DISENGAGED');
    expect(effect.nudges[0].verdict).toBe('persisted');
  });

  it('uses the first clean prediction, not a later one', () => {
    const effect = measureNudges(
      [nudge()],
      [predicted(400, 'PRODUCTIVE'), predicted(200, 'LOGIC_STRUGGLE')],
    );

    expect(effect.nudges[0].verdict).toBe('shifted');
  });

  it('leaves a nudge unmeasured when nothing clean arrives within the horizon', () => {
    const tooLate = measureNudges([nudge()], [predicted(11 * 60, 'PRODUCTIVE')]);
    const nothing = measureNudges([nudge()], []);

    expect(tooLate.nudges[0].verdict).toBe('unmeasured');
    expect(nothing.nudges[0].verdict).toBe('unmeasured');
  });

  it("never reads another session's predictions", () => {
    const effect = measureNudges([nudge()], [predicted(200, 'PRODUCTIVE', 'someone-else')]);

    expect(effect.nudges[0].verdict).toBe('unmeasured');
  });

  it('honours a different model window', () => {
    // With a 60s window, a prediction at 90s is already clean.
    const effect = measureNudges([nudge()], [predicted(90, 'PRODUCTIVE')], 60);

    expect(effect.nudges[0].verdict).toBe('recovered');
  });
});

describe('summarising nudges', () => {
  it('groups problem-state nudges by how the pair responded', () => {
    const effect = measureNudges(
      [
        nudge({ accepted: true }),
        nudge({ sessionId: 's2', accepted: false }),
        nudge({ sessionId: 's3', accepted: null }),
      ],
      [predicted(200, 'PRODUCTIVE'), predicted(200, 'DISENGAGED', 's2')],
    );

    const [accepted, dismissed, noResponse] = effect.byResponse;
    expect(accepted).toMatchObject({ key: 'accepted', shown: 1, measured: 1, improved: 1 });
    expect(dismissed).toMatchObject({ key: 'dismissed', shown: 1, measured: 1, unchanged: 1 });
    // Shown but never followed by a clean prediction.
    expect(noResponse).toMatchObject({ key: 'no_response', shown: 1, measured: 0 });
  });

  it('keeps positive reinforcement out of the problem-state groups', () => {
    // "Did the pair recover" and "did the pair stay productive" are different
    // questions. Folding them together would inflate the recovery rate with
    // pairs that had nothing to recover from.
    const effect = measureNudges(
      [
        nudge({ state: 'PRODUCTIVE', action: 'POSITIVE_REINFORCEMENT' }),
        nudge({ sessionId: 's2', state: 'PRODUCTIVE', action: 'POSITIVE_REINFORCEMENT' }),
      ],
      [predicted(200, 'PRODUCTIVE'), predicted(200, 'DRIVER_DOMINANCE', 's2')],
    );

    expect(effect.byResponse.every((group) => group.shown === 0)).toBe(true);
    expect(effect.byState).toEqual([]);
    expect(effect.reinforcement).toMatchObject({ shown: 2, measured: 2, improved: 1, otherChange: 1 });
  });

  it('orders states consistently and includes only those that were nudged', () => {
    const effect = measureNudges(
      [
        nudge({ state: 'LOGIC_STRUGGLE' }),
        nudge({ sessionId: 's2', state: 'DRIVER_DOMINANCE' }),
      ],
      [],
    );

    expect(effect.byState.map((group) => group.key)).toEqual(['DRIVER_DOMINANCE', 'LOGIC_STRUGGLE']);
  });

  it('marks a group too small to compare until it has enough measured nudges', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => nudge({ sessionId: `s${index}` }));
    const cleanFor = (count: number) =>
      Array.from({ length: count }, (_, index) => predicted(200, 'PRODUCTIVE', `s${index}`));

    const few = measureNudges(many(MIN_TO_COMPARE - 1), cleanFor(MIN_TO_COMPARE - 1));
    const enough = measureNudges(many(MIN_TO_COMPARE), cleanFor(MIN_TO_COMPARE));

    expect(few.byResponse[0].enoughToCompare).toBe(false);
    expect(enough.byResponse[0].enoughToCompare).toBe(true);
  });

  it('counts only measured nudges towards whether a group can be compared', () => {
    // Ten shown, none followed by a clean prediction: nothing to compare.
    const shownOnly = Array.from({ length: MIN_TO_COMPARE }, (_, index) =>
      nudge({ sessionId: `s${index}` }),
    );

    const effect = measureNudges(shownOnly, []);

    expect(effect.byResponse[0]).toMatchObject({ shown: MIN_TO_COMPARE, measured: 0, enoughToCompare: false });
  });
});
