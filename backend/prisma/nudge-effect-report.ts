/**
 * Whether the nudges changed what the model saw next, across every session.
 *
 *   npm run report:nudges             the tables
 *   npm run report:nudges -- --json   every measured nudge, for analysis elsewhere
 *
 * Read-only. The analytics page asks the same question of one student's own
 * sessions, because PairPath has no role that may read other pairs' records.
 * This is the view across all of them, for whoever holds the database
 * credentials - which is the view the research question actually needs.
 *
 * The measurement itself is src/modules/sessions/nudge-effect.ts, shared with
 * the page, so the two cannot disagree about what "helped" means.
 *
 * Only real recorded sessions are read. The simulated training corpus lives
 * in the simulated_* tables by design and never reaches pair_sessions.
 */

import { PrismaClient } from '@prisma/client';

import {
  DEFAULT_WINDOW_SECONDS,
  EffectGroup,
  measureNudges,
} from '../src/modules/sessions/nudge-effect';

const prisma = new PrismaClient();

const RESPONSE_LABEL: Record<string, string> = {
  accepted: 'marked helpful',
  dismissed: 'dismissed',
  no_response: 'no response',
};

const COLUMNS = ['shown', 'measured', 'recovered', 'same state', 'other problem'];

function cell(count: number, group: EffectGroup): string {
  if (!group.enoughToCompare || group.measured === 0) return String(count);
  return `${count} (${Math.round((100 * count) / group.measured)}%)`;
}

function table(title: string, rows: Array<[string, EffectGroup]>) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }

  console.log('  ' + ''.padEnd(18) + COLUMNS.map((column) => column.padStart(15)).join(''));
  for (const [label, group] of rows) {
    const counts = [group.shown, group.measured].map((n) => String(n).padStart(15)).join('');
    const outcomes = [group.improved, group.unchanged, group.otherChange]
      .map((n) => cell(n, group).padStart(15))
      .join('');
    const note = group.measured > 0 && !group.enoughToCompare ? '   too few to compare' : '';
    console.log('  ' + label.padEnd(18) + counts + outcomes + note);
  }
}

async function main() {
  const [nudges, predictions, nudgedSessions] = await Promise.all([
    prisma.intervention.findMany({
      select: { sessionId: true, state: true, action: true, shownAt: true, accepted: true },
    }),
    prisma.pairStatePrediction.findMany({
      select: { sessionId: true, windowEnd: true, predictedState: true },
    }),
    prisma.intervention.findMany({ distinct: ['sessionId'], select: { sessionId: true } }),
  ]);

  const windowSeconds = Number(process.env.ML_WINDOW_SECONDS) || DEFAULT_WINDOW_SECONDS;
  const effect = measureNudges(nudges, predictions, windowSeconds);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(effect, null, 2));
    return;
  }

  console.log(`Nudge effect across ${nudgedSessions.length} session(s) that received nudges`);
  console.log(
    `"Next" is the first prediction made only from activity after the nudge ` +
      `(window ${windowSeconds}s, horizon ${effect.horizonMinutes} min).`,
  );
  console.log(`Percentages appear only where a row has ${effect.minToCompare}+ measured nudges.`);

  table(
    'On a problem state, by how the pair responded',
    effect.byResponse.map((group) => [RESPONSE_LABEL[group.key] ?? group.key, group]),
  );
  table(
    'On a problem state, by which state triggered it',
    effect.byState.map((group) => [group.key.toLowerCase(), group]),
  );

  const reinforcement = effect.reinforcement;
  console.log(
    `\nEncouragement on a productive pair: ${reinforcement.shown} shown, ` +
      `${reinforcement.measured} measured, ${reinforcement.improved} stayed productive, ` +
      `${reinforcement.otherChange} slipped.`,
  );
  console.log(
    '\nDescriptive counts, not an effect size: a pair chooses whether to accept a nudge, ' +
      'and the classifier reading both sides of it was trained on simulated sessions.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
