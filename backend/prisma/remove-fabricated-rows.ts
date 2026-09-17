import { PrismaClient } from '@prisma/client';

/**
 * Remove the sessions the old seed invented.
 *
 *     npx ts-node --transpile-only -P prisma/tsconfig.json prisma/remove-fabricated-rows.ts
 *     ...                                                  ... --apply
 *
 * ========================== WHAT THESE ARE ==========================
 * `seedMLData()` in the old prisma/seeds.ts created two sessions -
 * `mock-session-productive` and `mock-session-driver-dom` - with members,
 * events, a feature window and two pair_state_predictions at 0.92 and 0.88
 * confidence, plus an intervention.
 *
 * feature_windows and pair_state_predictions ARE the research record: the
 * feature/prediction pairs kept so a human can label them later. Nothing on
 * those rows says they were invented, so anyone counting predictions,
 * measuring calibration or preparing a corpus for annotation would have
 * included them. The feature window is worse than useless - it uses names from
 * a retired scheme (`user1_edit_count_1m`) that the current fifteen-feature
 * extractor does not emit, so it could never be used for training even by
 * accident, only for miscounting.
 *
 * The seed no longer writes them. This removes what it already wrote.
 * ====================================================================
 *
 * ==================== WHY DELETE RATHER THAN MARK ====================
 * The gamification engine had a similar problem and the answer there was to
 * MARK the rows, because real students had really played those rounds against
 * defective questions - the rows were evidence of something that happened, and
 * deleting them would have made "we removed the data that was wrong"
 * indistinguishable from "we removed the data that disagreed with us".
 *
 * These are different. Nobody played them. They are rows a seed script
 * fabricated to make a demo page look populated, and there is no behaviour
 * behind them to preserve. Keeping them marked would leave two sessions in
 * every listing that have to be explained forever.
 *
 * Everything cascades from pair_sessions, so removing the two sessions removes
 * their members, events, windows, predictions and interventions with them. The
 * script prints exactly what it is about to take, and takes nothing without
 * --apply.
 * =====================================================================
 */

/** Fabricated by seedMLData(). Both ids are literals from that function. */
const FABRICATED_SESSION_IDS = ['mock-session-productive', 'mock-session-driver-dom'];

/**
 * Two accounts the old seed created, with passwords committed to this
 * repository. Removed only if nothing outside the fabricated sessions
 * references them - a real student may have been given one of these logins.
 */
const SEEDED_USER_IDS = ['user1', 'user2'];

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const sessions = await prisma.pairSession.findMany({
    where: { id: { in: FABRICATED_SESSION_IDS } },
    select: {
      id: true,
      status: true,
      _count: {
        select: {
          events: true,
          predictions: true,
          windows: true,
          interventions: true,
          members: true,
          reviews: true,
        },
      },
    },
  });

  const totals = await prisma.$transaction([
    prisma.pairStatePrediction.count(),
    prisma.featureWindow.count(),
    prisma.intervention.count(),
  ]);
  const [allPredictions, allWindows, allInterventions] = totals;

  console.log('\n── Fabricated sessions ─────────────────────────────────────');
  if (sessions.length === 0) {
    console.log('  None found. Nothing to do.\n');
    return;
  }

  let predictions = 0;
  let windows = 0;
  let interventions = 0;

  for (const session of sessions) {
    const c = session._count;
    predictions += c.predictions;
    windows += c.windows;
    interventions += c.interventions;
    console.log(
      `  ${session.id.padEnd(26)} ${session.status.padEnd(10)} ` +
        `members=${c.members} events=${c.events} predictions=${c.predictions} ` +
        `windows=${c.windows} interventions=${c.interventions} reviews=${c.reviews}`,
    );
  }

  // What share of the research record this is. A cleanup that removes a third
  // of the predictions is a different decision from one that removes a
  // rounding error, and whoever runs this should see which they are making.
  const share = (part: number, whole: number) =>
    whole === 0 ? 'n/a' : `${part} of ${whole} (${((part / whole) * 100).toFixed(0)}%)`;

  console.log('\n  share of the record being removed:');
  console.log(`    pair_state_predictions  ${share(predictions, allPredictions)}`);
  console.log(`    feature_windows         ${share(windows, allWindows)}`);
  console.log(`    interventions           ${share(interventions, allInterventions)}`);

  // The seeded accounts, only if they are not in anything real.
  const seededElsewhere = await prisma.pairSessionMember.findMany({
    where: {
      userId: { in: SEEDED_USER_IDS },
      sessionId: { notIn: FABRICATED_SESSION_IDS },
    },
    select: { userId: true, sessionId: true },
  });
  const removableUsers = SEEDED_USER_IDS.filter(
    (id) => !seededElsewhere.some((m) => m.userId === id),
  );

  console.log('\n  seeded accounts:');
  for (const id of SEEDED_USER_IDS) {
    const used = seededElsewhere.filter((m) => m.userId === id).length;
    console.log(
      `    ${id.padEnd(8)} ${used ? `in ${used} real session(s) - kept` : 'unused - will be removed'}`,
    );
  }

  if (!apply) {
    console.log('\n  DRY RUN - nothing written. Re-run with --apply.\n');
    return;
  }

  const removed = await prisma.pairSession.deleteMany({
    where: { id: { in: FABRICATED_SESSION_IDS } },
  });

  let removedUsers = 0;
  if (removableUsers.length) {
    removedUsers = (
      await prisma.user.deleteMany({ where: { id: { in: removableUsers } } })
    ).count;
  }

  console.log(
    `\n  removed ${removed.count} session(s) and ${removedUsers} seeded account(s).\n` +
      '  Their members, events, feature windows, predictions and interventions\n' +
      '  went with them - every relation cascades from pair_sessions.\n',
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
