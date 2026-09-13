/**
 * Did a nudge change what the model saw next?
 *
 * ======================== WHY THIS EXISTS ========================
 * Whether these interventions help is the research question PairPath is
 * built to answer. Every nudge records the state that triggered it and
 * whether the pair accepted it, and every minute the model records what it
 * sees - and nothing ever put the two side by side. The data to answer the
 * question has been accumulating unread.
 * ================================================================
 *
 * =================== WHAT COUNTS AS "AFTER" ===================
 * The first prediction made ENTIRELY from activity after the nudge, within
 * HORIZON_MS of it.
 *
 * The model reads only the last `windowSeconds` before a prediction's window
 * end (ML_WINDOW_SECONDS, 180 by default). A prediction a minute after a
 * nudge is therefore still two-thirds made of what the pair did BEFORE it,
 * and scoring it as the nudge's effect would credit or blame the nudge for
 * behaviour it never saw. So a prediction counts only once its window end is
 * a full window past the nudge.
 *
 * Note this is NOT `windowStart` on the prediction row. The gateway sends the
 * model the last fifty events and stores the earliest of those as the window
 * start, which can be many minutes before the three the model actually read.
 *
 * The horizon bounds attribution: a change twenty minutes later has too many
 * other causes to lay at the nudge's door.
 * ==============================================================
 *
 * =================== WHAT THIS CANNOT TELL YOU ===================
 * These are descriptive counts, not an effect size. Pairs choose whether to
 * accept a nudge, so an accepted nudge that "worked" may have gone to a pair
 * that was about to recover anyway. And the classifier producing both the
 * before and the after is trained on simulated sessions. `enoughToCompare`
 * marks where the numbers are too small to read at all.
 * =================================================================
 */

export const HORIZON_MS = 10 * 60 * 1000;
export const DEFAULT_WINDOW_SECONDS = 180;

/** Below this many measured nudges a group is shown, but not compared. */
export const MIN_TO_COMPARE = 10;

const PRODUCTIVE = 'PRODUCTIVE';
const PROBLEM_STATE_ORDER = ['DRIVER_DOMINANCE', 'PASSIVE_NAVIGATOR', 'LOGIC_STRUGGLE', 'DISENGAGED'];

export type NudgeResponse = 'accepted' | 'dismissed' | 'no_response';

/**
 * recovered  a problem state was followed by PRODUCTIVE
 * shifted    a problem state was followed by a different problem state
 * persisted  a problem state was followed by the same one
 * sustained  a PRODUCTIVE pair (positive reinforcement) stayed productive
 * slipped    a PRODUCTIVE pair was followed by a problem state
 * unmeasured no prediction made entirely after the nudge, within the horizon
 */
export type NudgeVerdict =
  | 'recovered'
  | 'shifted'
  | 'persisted'
  | 'sustained'
  | 'slipped'
  | 'unmeasured';

export interface NudgeInput {
  sessionId: string;
  state: string;
  action: string;
  shownAt: Date;
  accepted: boolean | null;
}

export interface PredictionInput {
  sessionId: string;
  windowEnd: Date;
  predictedState: string;
}

export interface MeasuredNudge {
  sessionId: string;
  state: string;
  action: string;
  shownAt: string;
  response: NudgeResponse;
  after: string | null;
  verdict: NudgeVerdict;
}

export interface EffectGroup {
  key: string;
  shown: number;
  measured: number;
  /** Recovered, for a problem state. Sustained, for reinforcement. */
  improved: number;
  /** Persisted - the same problem state again. Always 0 for reinforcement. */
  unchanged: number;
  /** Shifted to another problem state, or slipped out of PRODUCTIVE. */
  otherChange: number;
  enoughToCompare: boolean;
}

export interface NudgeEffect {
  windowSeconds: number;
  horizonMinutes: number;
  minToCompare: number;
  nudges: MeasuredNudge[];
  /** Nudges on a problem state, by how the pair responded. */
  byResponse: EffectGroup[];
  /** Nudges on a problem state, by which state triggered them. */
  byState: EffectGroup[];
  /** Positive reinforcement on a PRODUCTIVE pair - a different question. */
  reinforcement: EffectGroup;
}

function responseOf(accepted: boolean | null): NudgeResponse {
  if (accepted === true) return 'accepted';
  if (accepted === false) return 'dismissed';
  return 'no_response';
}

function verdictFor(before: string, after: string | null): NudgeVerdict {
  if (after === null) return 'unmeasured';
  if (before === PRODUCTIVE) return after === PRODUCTIVE ? 'sustained' : 'slipped';
  if (after === PRODUCTIVE) return 'recovered';
  return after === before ? 'persisted' : 'shifted';
}

function summarise(key: string, items: MeasuredNudge[]): EffectGroup {
  const measured = items.filter((item) => item.verdict !== 'unmeasured');
  const count = (...verdicts: NudgeVerdict[]) =>
    measured.filter((item) => verdicts.includes(item.verdict)).length;

  return {
    key,
    shown: items.length,
    measured: measured.length,
    improved: count('recovered', 'sustained'),
    unchanged: count('persisted'),
    otherChange: count('shifted', 'slipped'),
    enoughToCompare: measured.length >= MIN_TO_COMPARE,
  };
}

export function measureNudges(
  nudges: NudgeInput[],
  predictions: PredictionInput[],
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
  horizonMs: number = HORIZON_MS,
): NudgeEffect {
  const bySession = new Map<string, PredictionInput[]>();
  for (const prediction of predictions) {
    const list = bySession.get(prediction.sessionId) ?? [];
    list.push(prediction);
    bySession.set(prediction.sessionId, list);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime());
  }

  const measured: MeasuredNudge[] = [...nudges]
    .sort((a, b) => a.shownAt.getTime() - b.shownAt.getTime())
    .map((nudge) => {
      const shown = nudge.shownAt.getTime();
      const cleanFrom = shown + windowSeconds * 1000;
      const until = shown + horizonMs;

      const next = (bySession.get(nudge.sessionId) ?? []).find((prediction) => {
        const end = prediction.windowEnd.getTime();
        return end >= cleanFrom && end <= until;
      });
      const after = next?.predictedState ?? null;

      return {
        sessionId: nudge.sessionId,
        state: nudge.state,
        action: nudge.action,
        shownAt: nudge.shownAt.toISOString(),
        response: responseOf(nudge.accepted),
        after,
        verdict: verdictFor(nudge.state, after),
      };
    });

  const problems = measured.filter((item) => item.state !== PRODUCTIVE);
  const reinforcing = measured.filter((item) => item.state === PRODUCTIVE);

  const responses: NudgeResponse[] = ['accepted', 'dismissed', 'no_response'];
  const seenStates = [...new Set(problems.map((item) => item.state))];
  const states = [
    ...PROBLEM_STATE_ORDER.filter((state) => seenStates.includes(state)),
    ...seenStates.filter((state) => !PROBLEM_STATE_ORDER.includes(state)),
  ];

  return {
    windowSeconds,
    horizonMinutes: horizonMs / 60000,
    minToCompare: MIN_TO_COMPARE,
    nudges: measured,
    byResponse: responses.map((response) =>
      summarise(response, problems.filter((item) => item.response === response)),
    ),
    byState: states.map((state) =>
      summarise(state, problems.filter((item) => item.state === state)),
    ),
    reinforcement: summarise(PRODUCTIVE, reinforcing),
  };
}
