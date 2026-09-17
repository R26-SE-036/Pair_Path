/**
 * Turning a consented session into data that does not name anyone.
 *
 * Pure functions, so every rule the export depends on can be tested without a
 * database. prisma/export-research-data.ts is the command that uses them.
 */

import { createHmac } from 'crypto';

export interface ConsentRecord {
  userId: string;
  decision: string;
  version: string;
  decidedAt: Date;
}

/**
 * Students whose MOST RECENT decision is an agreement to THIS statement.
 *
 * Both conditions matter. An agreement followed by a withdrawal is a
 * withdrawal. An agreement to an earlier version of the statement is an
 * agreement to terms the student may no longer be shown.
 */
export function consentingUsers(records: ConsentRecord[], version: string): Set<string> {
  const latest = new Map<string, ConsentRecord>();
  for (const record of records) {
    const seen = latest.get(record.userId);
    if (!seen || record.decidedAt.getTime() >= seen.decidedAt.getTime()) {
      latest.set(record.userId, record);
    }
  }

  return new Set(
    [...latest.values()]
      .filter((record) => record.decision === 'GRANTED' && record.version === version)
      .map((record) => record.userId),
  );
}

/**
 * Sessions every member agreed to share.
 *
 * A session is a record of two people. One member's agreement is not
 * permission to export what their partner did in it, so a single missing
 * agreement leaves the whole session out.
 */
export function eligibleSessions<T extends { memberIds: string[] }>(
  sessions: T[],
  consenting: Set<string>,
): { included: T[]; excludedCount: number } {
  const included = sessions.filter(
    (session) =>
      session.memberIds.length > 0 && session.memberIds.every((id) => consenting.has(id)),
  );
  return { included, excludedCount: sessions.length - included.length };
}

export type PseudonymKind = 'user' | 'session' | 'intervention';

const PREFIX: Record<PseudonymKind, string> = { user: 'u_', session: 's_', intervention: 'i_' };

/**
 * A keyed hash in place of an id.
 *
 * Keyed, not a plain hash: a SHA-256 of a cuid can be recomputed by anyone who
 * has the database, which would make "anonymised" mean "renamed". With the
 * salt kept secret the mapping cannot be reversed, and with the same salt it
 * is stable across exports, so files from different runs still join.
 */
export function pseudonym(id: string, salt: string, kind: PseudonymKind): string {
  return PREFIX[kind] + createHmac('sha256', salt).update(`${kind}:${id}`).digest('hex').slice(0, 16);
}

/** Event metadata as an object: the gateway stores it as a JSON string. */
export function parseMetadata(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A timestamp relative to the start of its session, or the real one.
 *
 * Relative by default: every interval the model reads survives, and no date
 * does. In a class of forty, "Tuesday at 14:05" can be enough to say who.
 */
export function shiftTime(at: Date, origin: Date, keepDates: boolean): string {
  return keepDates ? at.toISOString() : new Date(at.getTime() - origin.getTime()).toISOString();
}

export interface RawEvent {
  sessionId: string;
  userId: string;
  role: string;
  eventType: string;
  timestamp: Date;
  metadata: unknown;
}

export interface AnonymiseOptions {
  salt: string;
  keepNotes: boolean;
  keepDates: boolean;
}

export interface ExportedEvent {
  sessionId: string;
  userId: string;
  role: string;
  eventType: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

/**
 * Metadata fields known to carry no personal content. An allowlist, so a field
 * added to an event later stays out of every export until someone decides it
 * belongs there - rather than leaking until someone notices it should not.
 */
const SAFE_FIELDS = new Set(['codeLength', 'success', 'hasError', 'correct', 'accepted']);

export function anonymiseEvent(
  event: RawEvent,
  origin: Date,
  options: AnonymiseOptions,
): ExportedEvent {
  const source = parseMetadata(event.metadata);
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (SAFE_FIELDS.has(key)) metadata[key] = value;
  }

  if (event.eventType === 'DISCUSSION_NOTE') {
    // How much was said feeds the model; what was said identifies people.
    const note = typeof source.note === 'string' ? source.note : '';
    metadata.noteLength = note.length;
    if (options.keepNotes) metadata.note = note;
  }

  if (event.eventType === 'ROLE_SWITCH' && source.newRoles && typeof source.newRoles === 'object') {
    /*
     * The ids INSIDE the roles map have to be replaced with exactly the
     * pseudonyms the events carry. build_windows.py rebuilds who was driving
     * by replaying newRoles and matching its keys to each event's userId -
     * replace one and not the other and every role-dependent feature in the
     * training set silently reads zero.
     */
    metadata.newRoles = Object.fromEntries(
      Object.entries(source.newRoles as Record<string, unknown>).map(([userId, role]) => [
        pseudonym(userId, options.salt, 'user'),
        role,
      ]),
    );
  }

  if (event.eventType === 'INTERVENTION_RESPONSE' && typeof source.interventionId === 'string') {
    metadata.interventionId = pseudonym(source.interventionId, options.salt, 'intervention');
  }

  return {
    sessionId: pseudonym(event.sessionId, options.salt, 'session'),
    userId: pseudonym(event.userId, options.salt, 'user'),
    role: event.role,
    eventType: event.eventType,
    timestamp: shiftTime(event.timestamp, origin, options.keepDates),
    metadata,
  };
}
