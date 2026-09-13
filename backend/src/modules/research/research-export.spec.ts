/**
 * What may leave the database, and in what shape.
 *
 * Two kinds of failure matter here and they pull in opposite directions: an
 * export that lets a person through, and an export so thoroughly scrubbed that
 * the training set it feeds is silently wrong. Both are tested.
 */

import {
  anonymiseEvent,
  consentingUsers,
  eligibleSessions,
  pseudonym,
  shiftTime,
} from './research-export';

const SALT = 'a-test-salt-that-is-long-enough';

describe('who may be exported', () => {
  const record = (userId: string, decision: string, version: string, iso: string) => ({
    userId,
    decision,
    version,
    decidedAt: new Date(iso),
  });

  it('counts only a most recent agreement, to the current statement', () => {
    const consenting = consentingUsers(
      [
        record('agreed', 'GRANTED', 'v2', '2026-09-01T00:00:00Z'),
        record('withdrew', 'GRANTED', 'v2', '2026-09-01T00:00:00Z'),
        record('withdrew', 'DECLINED', 'v2', '2026-09-02T00:00:00Z'),
        record('earlier-terms', 'GRANTED', 'v1', '2026-09-01T00:00:00Z'),
        record('declined', 'DECLINED', 'v2', '2026-09-01T00:00:00Z'),
        record('changed-back', 'DECLINED', 'v2', '2026-09-01T00:00:00Z'),
        record('changed-back', 'GRANTED', 'v2', '2026-09-03T00:00:00Z'),
      ],
      'v2',
    );

    expect([...consenting].sort()).toEqual(['agreed', 'changed-back']);
  });

  it('exports a session only when every member agreed', () => {
    const { included, excludedCount } = eligibleSessions(
      [
        { id: 'both-agreed', memberIds: ['a', 'b'] },
        { id: 'partner-did-not', memberIds: ['a', 'c'] },
        { id: 'on-their-own', memberIds: ['a'] },
        { id: 'nobody', memberIds: [] },
      ],
      new Set(['a', 'b']),
    );

    expect(included.map((session) => session.id)).toEqual(['both-agreed', 'on-their-own']);
    expect(excludedCount).toBe(2);
  });
});

describe('replacing ids', () => {
  it('is stable for one salt, so files from different exports still join', () => {
    expect(pseudonym('cmu0665tz0000', SALT, 'user')).toBe(pseudonym('cmu0665tz0000', SALT, 'user'));
  });

  it('changes with the salt, and between kinds of id', () => {
    const id = 'cmu0665tz0000';
    expect(pseudonym(id, SALT, 'user')).not.toBe(pseudonym(id, `${SALT}-other`, 'user'));
    expect(pseudonym(id, SALT, 'user').slice(2)).not.toBe(pseudonym(id, SALT, 'session').slice(2));
  });

  it('never carries the id it replaces', () => {
    const id = 'cmu0665tz0000nikl6t91w46k';
    expect(pseudonym(id, SALT, 'user')).not.toContain(id);
    expect(pseudonym(id, SALT, 'user')).not.toContain(id.slice(0, 8));
  });
});

describe('anonymising an event', () => {
  const origin = new Date('2026-09-13T10:00:00.000Z');
  const options = { salt: SALT, keepNotes: false, keepDates: false };

  const event = (eventType: string, metadata: object, iso = '2026-09-13T10:03:12.000Z') => ({
    sessionId: 'session-1',
    userId: 'student-a',
    role: 'DRIVER',
    eventType,
    timestamp: new Date(iso),
    // As the gateway stores it.
    metadata: JSON.stringify(metadata),
  });

  it('takes out what a student wrote in the chat, keeping how much', () => {
    const note = anonymiseEvent(event('DISCUSSION_NOTE', { note: "I think it's the loop, Priya" }), origin, options);

    expect(note.metadata).toEqual({ noteLength: 28 });
    expect(JSON.stringify(note)).not.toContain('Priya');
  });

  it('keeps chat text only when asked to', () => {
    const note = anonymiseEvent(event('DISCUSSION_NOTE', { note: 'the loop' }), origin, {
      ...options,
      keepNotes: true,
    });

    expect(note.metadata).toEqual({ noteLength: 8, note: 'the loop' });
  });

  it('replaces the ids inside a role switch with the ones the events carry', () => {
    // build_windows.py rebuilds roles from newRoles and matches its keys to
    // each event's userId. Replace one and not the other, and every
    // role-dependent feature silently reads zero.
    const switched = anonymiseEvent(
      event('ROLE_SWITCH', { newRoles: { 'student-a': 'NAVIGATOR', 'student-b': 'DRIVER' } }),
      origin,
      options,
    );
    const partnerEdit = anonymiseEvent(
      { ...event('CODE_EDIT', { codeLength: 40 }), userId: 'student-b' },
      origin,
      options,
    );

    expect(switched.metadata.newRoles).toEqual({
      [switched.userId]: 'NAVIGATOR',
      [partnerEdit.userId]: 'DRIVER',
    });
    expect(JSON.stringify(switched)).not.toContain('student-');
  });

  it('keeps everything the model reads from a run', () => {
    const run = anonymiseEvent(
      event('CODE_RUN_RESULT', { success: true, hasError: false, correct: false }),
      origin,
      options,
    );

    expect(run.metadata).toEqual({ success: true, hasError: false, correct: false });
  });

  it('drops any field nobody has declared safe', () => {
    // An edit that one day carries the code itself must not start exporting
    // it by default.
    const edit = anonymiseEvent(
      event('CODE_EDIT', { codeLength: 17, code: 'class Priya {}' }),
      origin,
      options,
    );

    expect(edit.metadata).toEqual({ codeLength: 17 });
  });

  it('replaces the intervention id in a response to a nudge', () => {
    const response = anonymiseEvent(
      event('INTERVENTION_RESPONSE', { interventionId: 'cmintervention1', accepted: true }),
      origin,
      options,
    );

    expect(response.metadata).toEqual({
      interventionId: pseudonym('cmintervention1', SALT, 'intervention'),
      accepted: true,
    });
  });

  it('moves a session to its own start, keeping every interval', () => {
    const first = anonymiseEvent(event('JOIN', {}, '2026-09-13T10:00:00.000Z'), origin, options);
    const later = anonymiseEvent(event('JOIN', {}, '2026-09-13T10:03:12.000Z'), origin, options);

    expect(first.timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(Date.parse(later.timestamp) - Date.parse(first.timestamp)).toBe(192_000);
  });

  it('keeps real dates only when asked to', () => {
    expect(shiftTime(new Date('2026-09-13T10:03:12.000Z'), origin, true)).toBe('2026-09-13T10:03:12.000Z');
  });
});
