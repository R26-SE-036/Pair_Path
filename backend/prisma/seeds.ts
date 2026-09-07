import { Prisma, PrismaClient } from '@prisma/client';

import { QUESTIONS, TOPICS } from '../src/content/question-bank';

/**
 * Load the exercise bank.
 *
 *     npx ts-node prisma/seeds.ts
 *
 * ========================= WHAT CHANGED HERE =========================
 * Idempotent. It used to `create` topics and questions with fixed ids, so the
 * second run died on a unique-constraint violation and the only way to reseed
 * was to empty the tables by hand. Upserting means running it after editing
 * the bank updates what is there instead.
 *
 * It also used to call itself at the bottom of the file, so importing it for
 * any reason - a test, a script, an editor's auto-import - wrote to the
 * database. It runs when it is the entry point and not otherwise.
 *
 * And it no longer seeds users or ML data. The users were two accounts with
 * passwords committed to this repository. The ML data was two fabricated
 * sessions with a feature window and two predictions, written into the tables
 * that hold the research record with nothing marking them as invented - see
 * the note in the previous version of this file.
 * =====================================================================
 */
const prisma = new PrismaClient();

export async function seedDatabase(client: PrismaClient = prisma) {
  for (const topic of TOPICS) {
    await client.topic.upsert({
      where: { id: topic.id },
      update: { name: topic.name, description: topic.description },
      create: topic,
    });
  }

  for (const question of QUESTIONS) {
    // `invitesErrors` is documentation, not a column: it records which Code
    // Coach error types an exercise tends to produce, which is what makes the
    // bank's coverage checkable. The schema has nowhere to put it.
    const { invitesErrors, ...row } = question;

    await client.question.upsert({
      where: { id: row.id },
      update: {
        topicId: row.topicId,
        title: row.title,
        description: row.description,
        difficulty: row.difficulty,
        starterCode: row.starterCode,
        referenceSolution: row.referenceSolution,
        conceptTags: row.conceptTags,
        // Prisma types a Json column as InputJsonValue, which an interface
        // does not satisfy - a TypeScript interface has no index signature, so
        // ReviewPrompt[] is not structurally an array of JSON objects even
        // though every value in it is. The alternative is typing the bank as
        // anonymous objects, which would lose the compile-time check that
        // every prompt has both a `prompt` and an `expected`.
        reviewQuestions: row.reviewQuestions as unknown as Prisma.InputJsonValue,
      },
      create: {
        ...row,
        conceptTags: row.conceptTags,
        reviewQuestions: row.reviewQuestions as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const tags = new Set(QUESTIONS.flatMap((q) => q.conceptTags));
  console.log(
    `Seeded ${TOPICS.length} topics and ${QUESTIONS.length} questions ` +
      `covering ${tags.size} concept tags.`,
  );

  await archiveSuperseded(client);
  await reportStaleContent(client);
}

/**
 * Take questions outside the bank out of circulation.
 *
 * They stay in the table - sessions point at them, and those sessions with
 * their events and predictions are the record of everything anyone has done
 * here. What stops is offering them for NEW sessions, which matters because
 * they carry the free-text tags the bank exists to replace: a pair starting
 * one today would produce a session tagged `modulo` and `bounds`, joining to
 * no lesson, no game and no detector.
 *
 * Anything in the bank is un-archived, so restoring a question is a matter of
 * putting it back in the bank rather than editing the database.
 */
async function archiveSuperseded(client: PrismaClient) {
  const bankIds = QUESTIONS.map((q) => q.id);

  const retired = await client.question.updateMany({
    where: { id: { notIn: bankIds }, archived: false },
    data: { archived: true },
  });

  await client.question.updateMany({
    where: { id: { in: bankIds }, archived: true },
    data: { archived: false },
  });

  if (retired.count) {
    console.log(`Archived ${retired.count} question(s) superseded by the bank.`);
  }
}

/**
 * Say what is in the database that is not in the bank.
 *
 * Reported, never deleted. A question outside the bank is usually a superseded
 * exercise, but a pair may have worked on it - and those sessions, their
 * events and the predictions made about them are the research record. Prisma
 * would refuse the delete anyway (PairSession.questionId has no cascade), and
 * the right answer to "this exercise is obsolete" is rarely "destroy the
 * evidence that anyone used it".
 *
 * So this prints what is stale and how many sessions depend on each, and
 * leaves the decision to a person.
 */
async function reportStaleContent(client: PrismaClient) {
  const bankIds = new Set(QUESTIONS.map((q) => q.id));
  const topicIds = new Set(TOPICS.map((t) => t.id));

  const questions = await client.question.findMany({
    select: { id: true, title: true, _count: { select: { sessions: true } } },
  });
  const stale = questions.filter((q) => !bankIds.has(q.id));

  const topics = await client.topic.findMany({ select: { id: true, name: true } });
  const staleTopics = topics.filter((t) => !topicIds.has(t.id));

  if (stale.length === 0 && staleTopics.length === 0) return;

  console.log('\nNot in the bank, left in place:');
  for (const question of stale) {
    const used = question._count.sessions;
    console.log(
      `  question ${question.id} (${question.title}) - ` +
        (used ? `${used} session(s) reference it` : 'unused'),
    );
  }
  for (const topic of staleTopics) {
    console.log(`  topic    ${topic.id} (${topic.name})`);
  }

  const unused = stale.filter((q) => q._count.sessions === 0).map((q) => q.id);
  if (unused.length) {
    console.log(
      `\n  ${unused.length} of these are unused and safe to remove:\n` +
        `    npx ts-node prisma/seeds.ts --prune\n`,
    );
  }
}

/** Remove bank-less questions that no session has ever used. */
async function pruneUnused(client: PrismaClient) {
  const bankIds = QUESTIONS.map((q) => q.id);

  const { count } = await client.question.deleteMany({
    where: { id: { notIn: bankIds }, sessions: { none: {} } },
  });

  console.log(`Removed ${count} unused question(s) that are not in the bank.`);
}

// Only when run directly. Importing this file must not write to a database.
if (require.main === module) {
  const prune = process.argv.includes('--prune');

  seedDatabase()
    .then(() => (prune ? pruneUnused(prisma) : undefined))
    .catch((error) => {
      console.error('Error seeding database:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
