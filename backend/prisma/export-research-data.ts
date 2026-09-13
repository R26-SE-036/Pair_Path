/**
 * Export the sessions students agreed to share, with the people taken out.
 *
 *   RESEARCH_EXPORT_SALT=<long secret> npm run research:export -- --out ../research-export
 *
 *   --dry-run         count what would be exported; writes nothing, needs no salt
 *   --include-notes   keep what students wrote in the chat (removed by default)
 *   --keep-dates      keep real timestamps (each session starts at 1970-01-01 by default)
 *
 * ========================= WHAT GETS INCLUDED =========================
 * A session is exported only when EVERY member's most recent decision is
 * GRANTED, for the current statement (content/research-consent.ts). A session
 * is a record of two people; one person's agreement is not permission to hand
 * over what their partner did in it. Active sessions are never exported.
 *
 * Ids are replaced by keyed hashes - stable across exports made with the same
 * salt, so a researcher can join files, and useless to anyone without it.
 * Keep the salt out of the export and out of the repository.
 *
 * Metadata is an allowlist, not a denylist: only fields known to carry no
 * personal content survive, so a field added to an event later is left out of
 * exports until someone decides it belongs in them.
 * =======================================================================
 *
 * events.json is exactly what ml/dev_tools/build_windows.py reads.
 *
 * Write the export OUTSIDE this repository. It is research data about real
 * people, and a git history is the hardest place to take it back out of.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { RESEARCH_CONSENT_VERSION } from '../src/content/research-consent';
import {
  anonymiseEvent,
  consentingUsers,
  eligibleSessions,
  pseudonym,
  shiftTime,
} from '../src/modules/research/research-export';
import { summariseOutcome } from '../src/modules/sessions/session-outcome';

const MIN_SALT_LENGTH = 16;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keepNotes = process.argv.includes('--include-notes');
  const keepDates = process.argv.includes('--keep-dates');
  const out = argument('--out');
  const salt = process.env.RESEARCH_EXPORT_SALT ?? '';

  if (!dryRun && !out) {
    throw new Error('Say where to write the export: --out <directory outside this repository>.');
  }
  if (!dryRun && salt.length < MIN_SALT_LENGTH) {
    throw new Error(
      `RESEARCH_EXPORT_SALT must be set to a secret of at least ${MIN_SALT_LENGTH} characters. ` +
        'Without it the replacement ids could be recomputed from the real ones.',
    );
  }

  const prisma = new PrismaClient();
  try {
    const decisions = await prisma.researchConsent.findMany({
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, decision: true, version: true, decidedAt: true },
    });
    const consenting = consentingUsers(decisions, RESEARCH_CONSENT_VERSION);

    const finished = await prisma.pairSession.findMany({
      where: { status: { in: ['COMPLETED', 'EXPIRED'] } },
      select: {
        id: true,
        status: true,
        questionId: true,
        startedAt: true,
        endedAt: true,
        members: { select: { userId: true } },
        question: { select: { difficulty: true, conceptTags: true, expectedOutput: true } },
      },
    });

    const { included, excludedCount } = eligibleSessions(
      finished.map((session) => ({ ...session, memberIds: session.members.map((m) => m.userId) })),
      consenting,
    );

    console.log(`Consent statement ${RESEARCH_CONSENT_VERSION}: ${consenting.size} student(s) currently agree.`);
    console.log(
      `${finished.length} finished session(s): ${included.length} eligible, ` +
        `${excludedCount} left out because not every member agreed.`,
    );
    if (dryRun) {
      console.log('Dry run: nothing written.');
      return;
    }

    const ids = included.map((session) => session.id);
    const [events, predictions, interventions, reviews] = await Promise.all([
      prisma.sessionEvent.findMany({ where: { sessionId: { in: ids } }, orderBy: { timestamp: 'asc' } }),
      prisma.pairStatePrediction.findMany({ where: { sessionId: { in: ids } }, orderBy: { windowEnd: 'asc' } }),
      prisma.intervention.findMany({ where: { sessionId: { in: ids } }, orderBy: { shownAt: 'asc' } }),
      prisma.reviewSubmission.findMany({ where: { sessionId: { in: ids } } }),
    ]);

    // Each session's clock starts at its own first event, so no calendar date
    // survives but every interval the model reads is unchanged.
    const origin = new Map<string, Date>();
    for (const session of included) origin.set(session.id, session.startedAt);
    for (const event of events) {
      const seen = origin.get(event.sessionId)!;
      if (event.timestamp < seen) origin.set(event.sessionId, event.timestamp);
    }
    const options = { salt, keepNotes, keepDates };
    const at = (sessionId: string, when: Date) => shiftTime(when, origin.get(sessionId)!, keepDates);

    const exported = {
      'events.json': events.map((event) => anonymiseEvent(event, origin.get(event.sessionId)!, options)),
      'sessions.json': included.map((session) => {
        const outcome = summariseOutcome({
          session,
          question: {
            title: null,
            difficulty: session.question.difficulty,
            conceptTags: session.question.conceptTags,
            hasExpectedOutput: session.question.expectedOutput !== null,
          },
          runResults: events.filter((e) => e.sessionId === session.id && e.eventType === 'CODE_RUN_RESULT'),
          myReview: null,
          promptCount: 0,
          bankErrorType: null,
        });
        return {
          sessionId: pseudonym(session.id, salt, 'session'),
          questionId: session.questionId,
          conceptTags: outcome.conceptTags,
          difficulty: outcome.difficulty,
          status: session.status,
          memberCount: session.memberIds.length,
          durationSeconds: outcome.durationSeconds,
          gradedRunCount: outcome.gradedRunCount,
          correctRunCount: outcome.correctRunCount,
          solved: outcome.solved,
          secondsToSolve: outcome.secondsToSolve,
        };
      }),
      'predictions.json': predictions.map((prediction) => ({
        sessionId: pseudonym(prediction.sessionId, salt, 'session'),
        windowEnd: at(prediction.sessionId, prediction.windowEnd),
        predictedState: prediction.predictedState,
        confidence: prediction.confidence,
        modelVersion: prediction.modelVersion,
      })),
      'interventions.json': interventions.map((intervention) => ({
        interventionId: pseudonym(intervention.id, salt, 'intervention'),
        sessionId: pseudonym(intervention.sessionId, salt, 'session'),
        state: intervention.state,
        action: intervention.action,
        shownAt: at(intervention.sessionId, intervention.shownAt),
        accepted: intervention.accepted,
      })),
      'reviews.json': reviews.map((review) => ({
        sessionId: pseudonym(review.sessionId, salt, 'session'),
        userId: pseudonym(review.userId, salt, 'user'),
        score: review.score,
        answers: review.answers,
      })),
    };

    fs.mkdirSync(out!, { recursive: true });
    for (const [file, rows] of Object.entries(exported)) {
      fs.writeFileSync(path.join(out!, file), JSON.stringify(rows, null, 2));
    }
    fs.writeFileSync(
      path.join(out!, 'manifest.json'),
      JSON.stringify(
        {
          consentVersion: RESEARCH_CONSENT_VERSION,
          sessionsIncluded: included.length,
          sessionsLeftOut: excludedCount,
          counts: Object.fromEntries(Object.entries(exported).map(([file, rows]) => [file, rows.length])),
          chatTextIncluded: keepNotes,
          realDatesIncluded: keepDates,
          note: 'events.json is the input ml/dev_tools/build_windows.py reads.',
        },
        null,
        2,
      ),
    );

    console.log(`Wrote ${Object.keys(exported).length + 1} files to ${path.resolve(out!)}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
