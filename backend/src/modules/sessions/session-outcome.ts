/**
 * What a finished pair session amounted to, for one of the two students in it.
 *
 * ====================== WHY IT IS DERIVED HERE ======================
 * The outcome is reported to Code Coach, where it moves the student's concept
 * mastery and can open a Study Guider lesson. So it is computed from the
 * session's own record, once, by the service that owns that record.
 *
 * The alternative was letting each student's browser assemble it from what
 * it happened to have seen - two students, two browsers, two slightly
 * different accounts of the same session, and a report that depended on
 * whether a tab stayed open. The web app's route handler reads this with the
 * student's PairPath token and forwards it with their Code Coach token; the
 * browser only ever says which session to report.
 * ===================================================================
 */

export interface SessionOutcome {
  sessionId: string;
  status: string;
  questionId: string;
  questionTitle: string | null;
  conceptTags: string[];
  difficulty: string | null;
  /** The Code Coach error type the exercise is built around, when the bank names one. */
  errorType: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Every recorded run, graded or not. */
  runCount: number;
  /** Runs that could be compared against the exercise's expected output. */
  gradedRunCount: number;
  correctRunCount: number;
  /**
   * Whether any graded run produced the expected output - or null when no run
   * could be graded, which is not the same as unsolved. See `verdictOf`.
   */
  solved: boolean | null;
  secondsToSolve: number | null;
  reviewSubmitted: boolean;
  reviewScorePercent: number | null;
}

export interface OutcomeInput {
  session: {
    id: string;
    status: string;
    questionId: string;
    startedAt: Date;
    endedAt: Date | null;
  };
  question: {
    title: string | null;
    difficulty: string | null;
    conceptTags: unknown;
    /** Whether a run COULD be graded. The expected text itself never gets this far. */
    hasExpectedOutput: boolean;
  } | null;
  /** CODE_RUN_RESULT events, in any order. */
  runResults: Array<{ timestamp: Date; metadata: unknown }>;
  myReview: { score: number } | null;
  promptCount: number;
  bankErrorType: string | null;
}

/**
 * Event metadata as an object, whichever way it was stored.
 *
 * The gateway writes it as a JSON string, not an object - so `metadata.correct`
 * read straight off the row is undefined for every run ever recorded, and an
 * outcome built that way would call every session ungraded.
 */
function metadataOf(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Was this run graded, and was it right?
 *
 * ==================== GRADED IS NOT THE SAME AS RUN ====================
 * `correct` has been written on every CODE_RUN_RESULT since the expected-output
 * check shipped: true, false, or null when the program did not compile. A
 * compile failure is therefore a graded attempt that did not solve it.
 *
 * Runs recorded before that carry no `correct` key at all. Counting them as
 * wrong would report every early session as a struggle it never was - and
 * reported struggle opens lessons. So they are left unjudged, and so is any
 * run on an exercise with no expected output to compare against.
 * =======================================================================
 */
function verdictOf(metadata: unknown): { graded: boolean; correct: boolean } {
  const fields = metadataOf(metadata);
  if (!fields || !('correct' in fields)) return { graded: false, correct: false };
  return { graded: true, correct: fields.correct === true };
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

export function summariseOutcome(input: OutcomeInput): SessionOutcome {
  const { session, question, myReview, promptCount, bankErrorType } = input;

  const runs = [...input.runResults].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const graded = question?.hasExpectedOutput
    ? runs.filter((run) => verdictOf(run.metadata).graded)
    : [];
  const correct = graded.filter((run) => verdictOf(run.metadata).correct);

  const tags = question?.conceptTags;

  return {
    sessionId: session.id,
    status: session.status,
    questionId: session.questionId,
    questionTitle: question?.title ?? null,
    conceptTags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
      : [],
    difficulty: question?.difficulty ?? null,
    errorType: bankErrorType,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    durationSeconds: session.endedAt ? secondsBetween(session.startedAt, session.endedAt) : null,
    runCount: runs.length,
    gradedRunCount: graded.length,
    correctRunCount: correct.length,
    solved: graded.length ? correct.length > 0 : null,
    secondsToSolve: correct.length ? secondsBetween(session.startedAt, correct[0].timestamp) : null,
    reviewSubmitted: myReview !== null,
    reviewScorePercent:
      myReview && promptCount > 0
        ? Math.min(100, Math.round((100 * myReview.score) / promptCount))
        : null,
  };
}
