/**
 * Loads the simulated training corpus from ml-service/data/ into Postgres so
 * it can be browsed and demonstrated instead of living only as files.
 *
 * Sources (produced by dev_tools/generate_demo_sessions.py + build_windows.py):
 *   data/labels/session_labels.csv       -> simulated_sessions      (200)
 *   data/raw_sessions/events.json        -> simulated_events     (14,771)
 *   data/extracted/labeled_windows.csv   -> simulated_windows     (3,709)
 *
 * These tables are separate from PairSession / SessionEvent on purpose. Those
 * hold real recorded behaviour; this is generated data and must stay
 * distinguishable from it at a glance.
 *
 * Idempotent: clears the three tables first, so re-running replaces rather
 * than duplicates.
 *
 *   npm run corpus:load
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const ML_DATA = path.join(__dirname, '..', '..', 'ml-service', 'data');
const CHUNK = 1000;

/** Minimal CSV reader — these files are generated, so no quoted commas. */
function readCsv(file: string): Record<string, string>[] {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

async function insertInChunks<T>(label: string, rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
    process.stdout.write(`\r  ${label}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

async function main() {
  const labelsPath = path.join(ML_DATA, 'labels', 'session_labels.csv');
  const eventsPath = path.join(ML_DATA, 'raw_sessions', 'events.json');
  const windowsPath = path.join(ML_DATA, 'extracted', 'labeled_windows.csv');

  for (const p of [labelsPath, eventsPath, windowsPath]) {
    if (!fs.existsSync(p)) {
      console.error(`[ABORT] missing source file: ${p}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('Clearing existing corpus...');
  await prisma.simulatedEvent.deleteMany({});
  await prisma.simulatedWindow.deleteMany({});
  await prisma.simulatedSession.deleteMany({});

  // ── sessions ────────────────────────────────────────────────────────
  const sessionRows = readCsv(labelsPath);
  await insertInChunks('sessions', sessionRows, (batch) =>
    prisma.simulatedSession.createMany({
      data: batch.map((r) => ({
        id: r.session_id,
        label: r.label,
        labelSource: r.label_source,
        rater: r.rater,
      })),
      skipDuplicates: true,
    }),
  );

  // ── events ──────────────────────────────────────────────────────────
  const raw = JSON.parse(fs.readFileSync(eventsPath, 'utf8')) as Array<{
    sessionId: string;
    userId: string;
    eventType: string;
    timestamp: number;
    metadata: unknown;
  }>;

  const known = new Set(sessionRows.map((r) => r.session_id));
  const events = raw.filter((e) => known.has(e.sessionId));
  if (events.length !== raw.length) {
    console.log(`  [note] skipped ${raw.length - events.length} event(s) with no matching session`);
  }

  await insertInChunks('events  ', events, (batch) =>
    prisma.simulatedEvent.createMany({
      data: batch.map((e) => ({
        sessionId: e.sessionId,
        userId: e.userId,
        eventType: e.eventType,
        // Generator timestamps are epoch seconds, not milliseconds.
        timestamp: new Date(e.timestamp * 1000),
        // metadata arrives as a JSON string; store the parsed object so its
        // fields stay reachable by a JSON path query.
        metadata: (typeof e.metadata === 'string' ? safeParse(e.metadata) : (e.metadata ?? {})) as any,
      })),
    }),
  );

  // ── windows ─────────────────────────────────────────────────────────
  const windowRows = readCsv(windowsPath);
  const idCols = ['session_id', 'window_start', 'window_end', 'label', 'label_source', 'rater'];
  const featureCols = Object.keys(windowRows[0]).filter((c) => !idCols.includes(c));

  await insertInChunks('windows ', windowRows, (batch) =>
    prisma.simulatedWindow.createMany({
      data: batch.map((r) => ({
        sessionId: r.session_id,
        windowStart: Number(r.window_start),
        windowEnd: Number(r.window_end),
        features: Object.fromEntries(featureCols.map((c) => [c, Number(r[c])])) as any,
        label: r.label,
        labelSource: r.label_source,
        rater: r.rater,
      })),
    }),
  );

  // ── report ──────────────────────────────────────────────────────────
  const [s, e, w] = await Promise.all([
    prisma.simulatedSession.count(),
    prisma.simulatedEvent.count(),
    prisma.simulatedWindow.count(),
  ]);
  console.log(`\nLoaded: ${s} sessions, ${e} events, ${w} windows (${featureCols.length} features each)`);

  const byLabel = await prisma.simulatedSession.groupBy({
    by: ['label'],
    _count: true,
    orderBy: { _count: { label: 'desc' } },
  });
  console.log('\nSessions per state:');
  byLabel.forEach((r) => console.log(`  ${String(r._count).padStart(4)}  ${r.label}`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
