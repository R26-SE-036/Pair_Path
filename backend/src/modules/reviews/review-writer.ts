/**
 * What the review model is asked, and the checks on what it answers.
 *
 * Pure: no HTTP and no database, so the prompt and every rule about what may
 * reach a student can be tested directly. ReviewGeneratorService does the
 * asking; ReviewsService stores the result.
 *
 * ========================= WHAT THE REVIEW IS =========================
 * Teach a little, then ask a little, one step at a time, about THIS session's
 * code. Then, once the quiz is done and the model solution is on screen:
 *
 *   - what the pair did well (1-2 real strengths)
 *   - their path to the solution: 2-3 changes to their own lines, each with
 *     why, and what it would have achieved - "with `i <= 5` your loop would
 *     have printed all five numbers"
 *   - one next step
 *
 * framed by how the session went. Solved is "two ways to the same answer",
 * not right against wrong. Unsolved is "you were two changes away". A free
 * session has no task and no model solution, so it gets strengths, two
 * improvements, and a real exercise from the bank to try next.
 *
 * Everything is checked before it is stored. A question with an answer index
 * past its options would mark a student wrong for a right answer, so a
 * response that does not hold together is regenerated once and then refused -
 * never patched into shape. Line ranges are checked against the pair's own
 * code, and a suggested exercise must be one the bank actually offers.
 * ======================================================================
 */

import { ReviewContent, ReviewImprovement, ReviewOutcome, ReviewSuggestion } from './session-review';

/** A bank exercise the model may suggest after a free session. */
export interface SuggestionCandidate {
  id: string;
  title: string;
  difficulty: string | null;
  concept_tags: string[];
}

/** Everything the model is told. Counts only - never chat text or names. */
export interface ReviewRequest {
  mode: 'solo' | 'pair';
  /** Null for a free-coding session. */
  exercise: {
    title: string;
    description: string;
    difficulty: string | null;
    concept_tags: string[];
    expected_output: string | null;
    reference_solution: string;
  } | null;
  code: string;
  outcome: ReviewOutcome;
  runs: { total: number; correct: number; failed: number };
  teamwork: Record<string, number> | null;
  /** Free sessions: what Code Coach found the code is about. */
  code_concepts: string[];
  /** Free sessions: real exercises to choose the suggestion from. */
  suggestions: SuggestionCandidate[];
}

export class ReviewError extends Error {}

const MIN_STEPS = 3;
const MAX_STEPS = 4;
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 4;
const MAX_REFLECTIONS = 2;

export function numbered(code: string): string {
  const lines = code.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width)} | ${line}`).join('\n');
}

const OUTCOME_TEXT: Record<ReviewOutcome, string> = {
  solved: 'SOLVED: a run printed exactly the expected output.',
  unsolved: 'NOT SOLVED: they ran it, but no run printed the expected output.',
  ungraded: 'NOT GRADED: there was no expected output to compare against, or the code was never run.',
  free: 'FREE CODING: there was no set task, so nothing to solve. They wrote whatever they chose.',
};

const STEPS_INSTRUCTION: Record<ReviewOutcome, string> = {
  solved:
    'It was SOLVED: reinforce WHY their code works, and use one step on a mistake that would have ' +
    'broken it or a way it could be clearer.',
  unsolved:
    'It was NOT SOLVED: the steps walk them toward the fix - first where their code goes wrong, then ' +
    'why, then what change fixes it - so that by the last step they could fix it themselves. Do not ' +
    'hand them the corrected program in the steps.',
  ungraded:
    'It was not graded: teach from what their code does compared with what the task asks, and point ' +
    'them at anything still missing.',
  free:
    'There was no task: teach from what their own code does - how it works, what it would print, and ' +
    'where it could go wrong.',
};

const FEEDBACK_INSTRUCTION: Record<ReviewOutcome, string> = {
  solved:
    '"improvements": 1 to 3 ways the model solution goes about it differently from their code, framed ' +
    'as TWO WAYS TO THE SAME ANSWER - never as their code being wrong. Each says what they could change, ' +
    'why the other way is worth knowing, and what it would gain (shorter, clearer, handles more cases).',
  unsolved:
    '"improvements": their PATH TO THE SOLUTION - the 2 or 3 smallest changes, in order, that would turn ' +
    'THEIR code into a working program. Each points at their lines, says what to change, why, and what it ' +
    'would have achieved - for example "with `i <= 5` your loop would have printed all five numbers". The ' +
    'summary says how close they were, by counting these changes: "you were two changes away".',
  ungraded:
    '"improvements": 2 or 3 changes that would make their code do what the task asks. Each points at their ' +
    'lines, says what to change, why, and what it would have achieved compared with the task.',
  free:
    '"improvements": exactly 2 things that would most improve the program they wrote - correctness first, ' +
    'then clarity or Java style. Each points at their lines, says what to change, why, and what it would ' +
    'achieve.',
};

function teamworkText(request: ReviewRequest): string {
  const team = request.teamwork;
  if (request.mode !== 'pair' || !team) return 'They worked ALONE.';
  return [
    'They worked as a PAIR: one DRIVER types, one NAVIGATOR reviews and guides, and they can swap.',
    `- Session length: about ${team.duration_minutes} minute(s); role switches: ${team.role_switches}.`,
    `- Edits while driving: ${team.edits_by_driver}; edits while navigating: ${team.edits_by_navigator}.`,
    `- One partner made ${team.busiest_partner_edit_percent}% of all edits.`,
    `- Runs by the driver: ${team.runs_by_driver}; by the navigator: ${team.runs_by_navigator}.`,
    `- Chat messages between them: ${team.chat_messages}.`,
  ].join('\n');
}

function exerciseText(request: ReviewRequest): string {
  const exercise = request.exercise;
  if (!exercise) {
    const concepts = request.code_concepts.length ? request.code_concepts.join(', ') : 'none detected';
    return [
      '=== THE SESSION ===',
      'FREE CODING: no exercise was set, so there is no task, no expected output and no model solution.',
      `Concepts Code Coach found in their code: ${concepts}`,
    ].join('\n');
  }

  return [
    '=== THE EXERCISE ===',
    `Title: ${exercise.title}`,
    `Task: ${exercise.description}`,
    `Difficulty: ${exercise.difficulty || 'not stated'}`,
    `Concepts: ${exercise.concept_tags.join(', ') || 'not stated'}`,
    exercise.expected_output
      ? `Expected output (what a correct program prints):\n${exercise.expected_output}`
      : 'This exercise has no single expected output.',
  ].join('\n');
}

function solutionText(request: ReviewRequest): string {
  if (!request.exercise) return '';
  return [
    '=== A MODEL SOLUTION - FOR YOU ONLY ===',
    'The student sees this only after the quiz, beside the "improvements". Use it to understand the right',
    'approach. Never paste it, or any complete corrected program, into any field.',
    request.exercise.reference_solution,
  ].join('\n');
}

function suggestionsText(request: ReviewRequest): string {
  if (request.exercise) return '';
  if (!request.suggestions.length) {
    return '=== EXERCISES TO SUGGEST ===\nNone available: set "suggestedExerciseId" to null.';
  }
  return [
    '=== EXERCISES TO SUGGEST (pick one id from this list, or null) ===',
    ...request.suggestions.map(
      (q) => `- id: ${q.id} | ${q.title} | ${q.difficulty || 'any level'} | ${q.concept_tags.join(', ')}`,
    ),
  ].join('\n');
}

export function buildPrompt(request: ReviewRequest): string {
  const pair = request.mode === 'pair';
  const free = request.exercise === null;
  const code = request.code.trim() ? numbered(request.code) : '(they left the editor empty)';

  const reflection = pair
    ? '- "reflection": 1 or 2 questions about HOW THEY WORKED TOGETHER, built on the facts under WHAT\n' +
      '  HAPPENED (role switches, who typed, who ran it, talking). Each has 3 or 4 options and NO right\n' +
      '  answer - they are for reflecting, and are not scored. Do not word any option as the good or the bad one.'
    : '- "reflection": always an empty list - they worked alone.';

  const freeFields = free
    ? '- "suggestedExerciseId": the id of ONE exercise from the list above that practises what their code is\n' +
      '  about, or null if none fits. "suggestionReason": one sentence on why it is a good next try.'
    : '- "solutionNote": 1-2 sentences shown beside the model solution, saying what it does that their code\n' +
      '  does not - or, if they solved it, how the two compare.';

  return `
You are 'Code Guru', a friendly Java tutor for first-year university students.

${pair ? 'A pair of students' : 'A student working alone'} just finished a ${free ? 'free coding session' : 'practice exercise'}. Write a short
TEACHING REVIEW of this session: teach a little, then ask a little, one step at a time, and then - shown
only after the questions are done - an encouraging look at what they did and what would have made it better.
It is about THIS code - not a general lesson on the topic.

${exerciseText(request)}

=== THEIR FINAL CODE (line numbers are added here and are not part of the code) ===
${code}

${solutionText(request)}

=== WHAT HAPPENED ===
${OUTCOME_TEXT[request.outcome]}
Runs: ${request.runs.total} in total; ${request.runs.correct} printed the expected output; ${request.runs.failed} failed to compile or crashed.
${teamworkText(request)}

${suggestionsText(request)}

=== WRITE THE REVIEW ===
- ${MIN_STEPS} or ${MAX_STEPS} steps. Each step has:
  - "teach": 2-3 short, plain sentences explaining ONE idea about their code.
  - "lines": [first, last], the lines of THEIR code the step is about, using the numbering above, or null.
  - "question": one multiple-choice question that checks the idea just taught. Ask what the code does,
    why, what it prints, or which change fixes it. It must be answerable from their code and the teaching
    above it. ${MIN_OPTIONS} or ${MAX_OPTIONS} options, exactly one correct. Wrong options are mistakes a beginner really
    makes, not jokes. Put the correct option in different positions across the steps.
    "answer" is the 0-based index of the correct option.
    "explanation": 1-2 sentences on why it is right, and what the most tempting wrong option gets wrong.
- ${STEPS_INSTRUCTION[request.outcome]}
- "strengths": 1 or 2 things they genuinely did well, each one sentence, specific to THEIR code or how they
  worked - never generic praise. If the editor was empty, praise only what the facts support.
- ${FEEDBACK_INSTRUCTION[request.outcome]}
  Each improvement: {"lines": [first, last] of THEIR code or null, "change": what to change, "why": why,
  "achieves": what it would have achieved}. Short sentences; code in backticks; never a whole program.
- "nextStep": one sentence - the single most useful thing to practise next.
- Speak to the student as "you"${pair ? ', meaning either partner - both read the same review - and "you and your partner" for the two of them' : ''}. Never invent names.
  Be warm and honest: motivate, never mock, never overpraise.
- Write code, identifiers and expressions in \`backticks\`.
${reflection}
- "title": 3 to 7 words. "summary": 1-2 warm, honest sentences recapping the session.
${freeFields}

Respond ONLY with valid JSON in exactly this shape:
{
  "title": "...",
  "summary": "...",
  "steps": [
    {
      "teach": "...",
      "lines": [3, 5],
      "question": { "prompt": "...", "options": ["...", "...", "..."], "answer": 1, "explanation": "..." }
    }
  ],
  "reflection": [${pair ? '{"prompt": "...", "options": ["...", "...", "..."]}' : ''}],
  "strengths": ["..."],
  "improvements": [{ "lines": [4, 4], "change": "...", "why": "...", "achieves": "..." }],
  "nextStep": "...",
  ${free ? '"suggestedExerciseId": "...",\n  "suggestionReason": "..."' : '"solutionNote": "..."'}
}
`.trim();
}

// ── Checking what came back ──────────────────────────────────────────────────

export function parseJson(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new ReviewError('The model did not return a JSON object.');
    try {
      value = JSON.parse(cleaned.slice(start, end + 1));
    } catch (error) {
      throw new ReviewError(`The model returned malformed JSON: ${(error as Error).message}`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewError('The model returned JSON that is not an object.');
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ReviewError(`${field} is missing or empty.`);
  return value.trim().slice(0, limit);
}

function optionalText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}

function requireOptions(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ReviewError(`${field} is not a list.`);
  const options = value.map((option) => requireText(option, field, 300));
  if (options.length < MIN_OPTIONS - 1 || options.length > MAX_OPTIONS + 1) {
    throw new ReviewError(`${field} has ${options.length} options.`);
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    throw new ReviewError(`${field} repeats an option.`);
  }
  return options;
}

/**
 * A [first, last] range inside the code, or null. Never an error: a range the
 * model got slightly wrong costs a highlight, not the review.
 */
export function lineRange(value: unknown, lineCount: number): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!value.every((n) => Number.isInteger(n))) return null;
  let [first, last] = value as [number, number];
  if (first > last) [first, last] = [last, first];
  if (first < 1 || first > lineCount) return null;
  return [first, Math.min(last, lineCount)];
}

/**
 * Whether a field pastes a program rather than describing a change.
 *
 * The improvements are shown beside the model solution, so this is not about
 * hiding the answer - it is about the section doing its job. "Replace the
 * whole thing with this" teaches nothing a reader can carry to the next
 * exercise; a change to one of their own lines does.
 */
function pastesAProgram(value: string): boolean {
  return /\bclass\s+\w+\s*\{/.test(value) || /public\s+static\s+void\s+main/.test(value) || value.split('\n').length > 4;
}

function improvementsOf(raw: unknown, lineCount: number): ReviewImprovement[] {
  const kept: ReviewImprovement[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const change = optionalText(item.change, 300);
    const why = optionalText(item.why, 400);
    const achieves = optionalText(item.achieves, 400);
    if (!change || !why || !achieves) continue;
    if ([change, why, achieves].some(pastesAProgram)) continue;
    kept.push({ lines: lineRange(item.lines, lineCount), change, why, achieves });
  }
  return kept;
}

/**
 * The model's answer as a review, or throw ReviewError.
 *
 * The quiz is held to the strict rules - it scores students. The sections
 * after it are held to their own: a review needs at least one strength and
 * one improvement to be worth showing, and an item that does not hold together
 * is dropped on its own.
 */
export function validateReview(raw: Record<string, unknown>, request: ReviewRequest): ReviewContent {
  const lineCount = request.code.split(/\r?\n/).length || 1;
  const free = request.exercise === null;

  const stepsRaw = raw.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length < MIN_STEPS - 1 || stepsRaw.length > MAX_STEPS + 1) {
    throw new ReviewError('The review needs 2 to 5 steps.');
  }

  const steps = stepsRaw.map((entry, index) => {
    const n = index + 1;
    const step = entry as Record<string, unknown> | null;
    const question = step?.question as Record<string, unknown> | undefined;
    if (!step || !question || typeof question !== 'object') throw new ReviewError(`Step ${n} has no question.`);
    const options = requireOptions(question.options, `step ${n} options`);
    const answer = question.answer;
    if (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= options.length) {
      throw new ReviewError(`Step ${n} answer does not point at an option.`);
    }
    return {
      teach: requireText(step.teach, `step ${n} teach`, 900),
      lines: lineRange(step.lines, lineCount),
      question: {
        prompt: requireText(question.prompt, `step ${n} prompt`, 400),
        options,
        answer: answer as number,
        explanation: requireText(question.explanation, `step ${n} explanation`, 600),
      },
    };
  });

  const reflection: ReviewContent['reflection'] = [];
  if (request.mode === 'pair') {
    for (const entry of Array.isArray(raw.reflection) ? raw.reflection : []) {
      const item = entry as Record<string, unknown> | null;
      try {
        reflection.push({
          prompt: requireText(item?.prompt, 'reflection prompt', 400),
          options: requireOptions(item?.options, 'reflection options'),
        });
      } catch {
        // Unscored and optional: a malformed one is dropped, not fatal.
      }
    }
  }

  const strengths = (Array.isArray(raw.strengths) ? raw.strengths : [])
    .map((entry) => optionalText(entry, 300))
    .filter((entry): entry is string => entry !== null)
    .slice(0, 2);
  if (strengths.length === 0) throw new ReviewError('The review names no strengths.');

  const improvements = improvementsOf(raw.improvements, lineCount).slice(0, free ? 2 : 3);
  if (improvements.length === 0) throw new ReviewError('The review has no improvements that hold together.');

  return {
    title: requireText(raw.title, 'title', 120),
    summary: requireText(raw.summary, 'summary', 600),
    steps,
    reflection: reflection.slice(0, MAX_REFLECTIONS),
    solutionNote: free ? null : requireText(raw.solutionNote, 'solutionNote', 600),
    strengths,
    improvements,
    nextStep: optionalText(raw.nextStep, 400),
    suggestion: free ? suggestionOf(raw, request) : null,
  };
}

/**
 * The exercise to try next, after a free session - always a real one.
 *
 * The model picks from the list it was given; an id that is not on it is
 * replaced by the first candidate, which was chosen for the concepts in their
 * code. A suggestion that cannot be started is worse than none.
 */
export function suggestionOf(raw: Record<string, unknown>, request: ReviewRequest): ReviewSuggestion | null {
  const picked = request.suggestions.find((q) => q.id === raw.suggestedExerciseId);
  const reason = optionalText(raw.suggestionReason, 400);
  if (picked && reason) return { questionId: picked.id, title: picked.title, reason };
  return fallbackSuggestion(request.suggestions);
}

/** Without the model: the best-matching candidate, with a reason that only says what is known. */
export function fallbackSuggestion(candidates: SuggestionCandidate[]): ReviewSuggestion | null {
  const first = candidates[0];
  if (!first) return null;
  const concepts = first.concept_tags.slice(0, 2).map((t) => t.replace(/_/g, ' '));
  return {
    questionId: first.id,
    title: first.title,
    reason: concepts.length
      ? `It practises ${concepts.join(' and ')}, which your code was working with.`
      : 'A good next exercise to try together.',
  };
}
