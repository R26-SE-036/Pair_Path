/**
 * The review a student is taken through when a session ends, as data.
 *
 * Pure functions only - no database, no HTTP - so the rules about what a
 * review is, who counts as a pair and what gets sent to the language model can
 * be tested directly. ReviewsService does the reading and writing.
 */

/** A fixed review prompt on the question, and the answer a good session gives. */
export interface ReviewPrompt {
  prompt: string;
  expected: boolean;
}

/**
 * Read the prompts off a question, in either shape.
 *
 * Questions seeded before `expected` existed store a plain array of strings.
 * Those are treated as expecting `true`, which is exactly the old scoring - so
 * an old row keeps the score it always had rather than silently changing.
 */
export function promptsOf(reviewQuestions: unknown): ReviewPrompt[] {
  if (!Array.isArray(reviewQuestions)) return [];

  return reviewQuestions.flatMap((entry) => {
    if (typeof entry === 'string') return [{ prompt: entry, expected: true }];
    if (entry && typeof entry === 'object' && 'prompt' in entry) {
      const row = entry as { prompt: unknown; expected?: unknown };
      return typeof row.prompt === 'string'
        ? [{ prompt: row.prompt, expected: row.expected !== false }]
        : [];
    }
    return [];
  });
}

export type ReviewMode = 'solo' | 'pair';

export interface ReviewStep {
  /** A few sentences of teaching before the question. Null for fixed prompts. */
  teach: string | null;
  /** [first, last] lines of the student's code the step is about. */
  lines: [number, number] | null;
  question: {
    prompt: string;
    options: string[];
    /** Index into options. Never sent to a client before the student answers. */
    answer: number;
    explanation: string | null;
  };
}

/** A question about how the pair worked together. No right answer, not scored. */
export interface ReviewReflection {
  prompt: string;
  options: string[];
}

export interface ReviewContent {
  title: string;
  summary: string | null;
  steps: ReviewStep[];
  reflection: ReviewReflection[];
  solutionNote: string | null;
}

const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;

function options(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) return null;
  const read = value.map((option) => text(option, 300));
  return read.every((option): option is string => option !== null) ? read : null;
}

function lines(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [first, last] = value;
  return Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first
    ? [first, last]
    : null;
}

/**
 * A review that holds together, or null.
 *
 * Applied to what Study Guider returns and again to what is read back from the
 * database. Study Guider checks the same things before answering; this is the
 * side that scores students, so it does not take that on trust.
 */
export function readContent(value: unknown): ReviewContent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) return null;

  const steps: ReviewStep[] = [];
  for (const entry of raw.steps) {
    const step = entry as Record<string, unknown> | null;
    const question = step?.question as Record<string, unknown> | undefined;
    const prompt = text(question?.prompt, 400);
    const choices = options(question?.options);
    const answer = question?.answer;
    if (!prompt || !choices || !Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= choices.length) {
      return null;
    }
    steps.push({
      teach: text(step?.teach, 900),
      lines: lines(step?.lines),
      question: { prompt, options: choices, answer: answer as number, explanation: text(question?.explanation, 600) },
    });
  }

  const reflection: ReviewReflection[] = [];
  for (const entry of Array.isArray(raw.reflection) ? raw.reflection : []) {
    const item = entry as Record<string, unknown> | null;
    const prompt = text(item?.prompt, 400);
    const choices = options(item?.options);
    if (prompt && choices) reflection.push({ prompt, options: choices });
  }

  return {
    title: text(raw.title, 120) ?? 'Looking back at your session',
    summary: text(raw.summary, 600),
    steps,
    reflection,
    solutionNote: text(raw.solutionNote, 600),
  };
}

/**
 * The exercise's fixed prompts as a review, for when none can be generated.
 *
 * Yes/No options, with the answer the prompt expects. No teaching text: these
 * were written as checks, and inventing an explanation for them here would be
 * content nobody wrote.
 */
export function fromQuestionBank(prompts: ReviewPrompt[]): ReviewContent {
  return {
    title: 'Looking back at your session',
    summary: null,
    steps: prompts.map((p) => ({
      teach: null,
      lines: null,
      question: { prompt: p.prompt, options: ['Yes', 'No'], answer: p.expected ? 0 : 1, explanation: null },
    })),
    reflection: [],
    solutionNote: null,
  };
}

/** How many questions are scored - what a review score is out of. */
export function scoredCountOf(storedContent: unknown, reviewQuestions: unknown): number {
  const content = storedContent === undefined || storedContent === null ? null : readContent(storedContent);
  return content ? content.steps.length : promptsOf(reviewQuestions).length;
}

/**
 * Solo or pair: whether a partner ever joined.
 *
 * Membership rather than activity, deliberately. A navigator who watched and
 * talked through the whole session wrote nothing the event log can see - and
 * that is still pairing. The teamwork counts sent with a pair review let the
 * model see a partner who hardly took part, and write the reflection for it.
 */
export function modeOf(members: Array<{ userId: string }>): ReviewMode {
  return new Set(members.map((m) => m.userId)).size >= 2 ? 'pair' : 'solo';
}

/** Event metadata as an object - the gateway stores it as a JSON string. */
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

export type ReviewOutcome = 'solved' | 'unsolved' | 'ungraded';

/** Runs, and whether any printed the expected output. Same rules as session-outcome.ts. */
export function runsOf(runResults: Array<{ metadata: unknown }>, hasExpectedOutput: boolean) {
  const fields = runResults.map((run) => metadataOf(run.metadata));
  const graded = hasExpectedOutput ? fields.filter((f) => f !== null && 'correct' in f) : [];
  const correct = graded.filter((f) => f!.correct === true).length;
  const failed = fields.filter((f) => f !== null && f.success === false).length;

  const outcome: ReviewOutcome = correct > 0 ? 'solved' : graded.length > 0 ? 'unsolved' : 'ungraded';
  return { outcome, runs: { total: runResults.length, correct, failed } };
}

/** Grouped event counts: one row per (user, role, event type). */
export interface EventCount {
  userId: string;
  role: string;
  eventType: string;
  count: number;
}

/**
 * How the pair worked, as counts. No chat text and no names ever leave here:
 * what two students wrote to each other is not sent to a language model.
 */
export function teamworkOf(counts: EventCount[], startedAt: Date, endedAt: Date | null) {
  const sum = (type: string, role?: string) =>
    counts
      .filter((c) => c.eventType === type && (role === undefined || c.role === role))
      .reduce((total, c) => total + c.count, 0);

  const editsByUser = new Map<string, number>();
  for (const c of counts) {
    if (c.eventType === 'CODE_EDIT') editsByUser.set(c.userId, (editsByUser.get(c.userId) ?? 0) + c.count);
  }
  const allEdits = [...editsByUser.values()].reduce((a, b) => a + b, 0);
  const busiest = allEdits ? Math.max(...editsByUser.values()) : 0;

  const end = endedAt ?? new Date();
  return {
    duration_minutes: Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 60000)),
    role_switches: sum('ROLE_SWITCH'),
    edits_by_driver: sum('CODE_EDIT', 'DRIVER'),
    edits_by_navigator: sum('CODE_EDIT', 'NAVIGATOR'),
    runs_by_driver: sum('CODE_RUN', 'DRIVER'),
    runs_by_navigator: sum('CODE_RUN', 'NAVIGATOR'),
    chat_messages: sum('DISCUSSION_NOTE'),
    busiest_partner_edit_percent: allEdits ? Math.round((100 * busiest) / allEdits) : 0,
  };
}

/** One answer as the student sees it once given: marked, with the explanation. */
export function markedAnswer(content: ReviewContent, answer: { step: number; choice: number; correct: boolean | null }) {
  const step = content.steps[answer.step];
  return {
    step: answer.step,
    choice: answer.choice,
    correct: step ? answer.correct : null,
    answer: step ? step.question.answer : null,
    explanation: step ? step.question.explanation : null,
  };
}
