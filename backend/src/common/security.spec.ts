/**
 * The two boundaries that were open, and a sweep to stop them reopening.
 *
 * Both failures here were invisible from the call site. `include: { user:
 * true }` is the shape every Prisma tutorial shows and reads as "give me the
 * user"; two tokens signed with the same secret and the same payload look
 * interchangeable because they were. Neither produced an error, a warning or a
 * failing test - the endpoints worked, and returned more than they should.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ACCESS_TOKEN, REFRESH_TOKEN, isAccessToken, isRefreshToken } from './tokens';
import {
  PUBLIC_MEMBERS,
  PUBLIC_QUESTION,
  PUBLIC_QUESTION_FIELDS,
  PUBLIC_USER,
} from './public-select';

const SRC = path.join(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8');

/** Every file under src/, so a new one is swept without being listed. */
function sourceFiles(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

/**
 * Source with comments removed.
 *
 * Crude - it does not understand a `//` inside a string literal - and that is
 * the right trade here. A false negative would need somebody to write the
 * exact text `user: true` inside a string; a false positive is what this
 * exists to avoid, because the alternative was exempting whole files, and an
 * exempted file is where the next one hides.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('what leaves the API', () => {
  it('never includes the password column', () => {
    expect(Object.keys(PUBLIC_USER)).toEqual(['id', 'firstName', 'lastName']);
    expect(PUBLIC_USER).not.toHaveProperty('password');
    // Frozen, so a caller cannot mutate the shared shape and widen it for
    // every other query at once.
    expect(Object.isFrozen(PUBLIC_USER)).toBe(true);
  });

  it('never includes the reference solution', () => {
    // referenceSolution is a complete working answer to the exercise. It was
    // served to the browser on every session load, before the pair had written
    // a line, because `include: { question: true }` returns every scalar.
    expect(PUBLIC_QUESTION_FIELDS).not.toHaveProperty('referenceSolution');
    expect(PUBLIC_QUESTION.select).not.toHaveProperty('referenceSolution');
    expect(Object.isFrozen(PUBLIC_QUESTION_FIELDS)).toBe(true);

    // The things a question DOES need to carry, so a future trim does not
    // quietly break the workspace or the peer review.
    for (const field of ['title', 'description', 'starterCode', 'reviewQuestions', 'conceptTags']) {
      expect(PUBLIC_QUESTION_FIELDS).toHaveProperty(field, true);
    }
  });

  it('exposes a member without exposing the account behind it', () => {
    expect(PUBLIC_MEMBERS.select.user).toEqual({ select: PUBLIC_USER });
    expect(PUBLIC_MEMBERS.select).not.toHaveProperty('password');
  });

  it('no query anywhere pulls a whole user or question row', () => {
    // A source sweep rather than a behavioural check, deliberately. The
    // failure mode is not that one query computes wrongly - it is that
    // somebody adds a tenth `include: { user: true }` months from now, because
    // it is the obvious thing to write. This is what notices.
    //
    // Comments are stripped first. Several files quote the old pattern in
    // order to explain why it was wrong, and a check that cannot tell an
    // explanation from a query would either fire on those or have to exempt
    // whole files - and an exempted file is where the next one hides.
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const relative = path.relative(SRC, file).replace(/\\/g, '/');

      for (const pattern of [/\buser:\s*true/g, /\bquestions?:\s*true/g]) {
        const hits = code.match(pattern);
        if (hits) offenders.push(`${relative}: ${hits.join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the sweep reads code and not prose', () => {
    // Otherwise the test above only asserts that nobody has written the words
    // down, which is a different claim from the one it is making.
    expect(stripComments('const a = 1; // include: { user: true }')).not.toContain('user: true');
    expect(stripComments('/* question: true */ const a = 1;')).not.toContain('question: true');
    expect(stripComments('include: { user: true },')).toContain('user: true');
  });
});

describe('access and refresh tokens are not interchangeable', () => {
  it('refuses a refresh token as a credential', () => {
    // This is the whole point. Both were `{ sub }` signed with the same secret,
    // so the seven-day refresh token was a valid Bearer token for seven days
    // and the one-hour access lifetime bought nothing.
    expect(isAccessToken({ sub: 'u1', typ: REFRESH_TOKEN })).toBe(false);
    expect(isAccessToken({ sub: 'u1', typ: ACCESS_TOKEN })).toBe(true);
  });

  it('refuses an access token at the refresh endpoint', () => {
    // The other direction: an access token used to be tradeable for a fresh
    // pair, so a leaked one could be renewed forever and never expired.
    expect(isRefreshToken({ sub: 'u1', typ: ACCESS_TOKEN })).toBe(false);
    expect(isRefreshToken({ sub: 'u1', typ: REFRESH_TOKEN })).toBe(true);
  });

  it('accepts a token minted before the field existed, as access only', () => {
    // Deliberate asymmetry. Rejecting untyped tokens would sign out everyone
    // holding one, including mid-session; accepting them as REFRESH tokens
    // would leave the actual hole open. The legacy tail is bounded by the
    // seven-day expiry.
    expect(isAccessToken({ sub: 'u1' })).toBe(true);
    expect(isRefreshToken({ sub: 'u1' })).toBe(false);
  });

  it('refuses a token with no subject, whatever it claims to be', () => {
    expect(isAccessToken({ sub: '', typ: ACCESS_TOKEN })).toBe(false);
    expect(isAccessToken(undefined)).toBe(false);
    expect(isRefreshToken(null)).toBe(false);
  });

  it('is what auth.service actually stamps on the tokens it signs', () => {
    // The helpers being right is worth nothing if the issuer does not use
    // them, and this pair - a constant and its use - is exactly the kind that
    // drifts silently.
    const source = read('modules/auth/auth.service.ts');
    expect(source).toContain('typ: ACCESS_TOKEN');
    expect(source).toContain('typ: REFRESH_TOKEN');
  });

  it('is enforced by both doors, not just the REST one', () => {
    // A gateway that accepted a token the API refuses would be the more useful
    // of the two to an attacker: it carries the whole live session.
    expect(read('modules/auth/jwt.strategy.ts')).toContain('isAccessToken');
    expect(read('modules/websocket/websocket.gateway.ts')).toContain('isAccessToken');
  });
});

describe('rate limiting is actually wired up', () => {
  it('registers the guard, not just the options', () => {
    // ThrottlerModule.forRoot only supplies configuration. Without an APP_GUARD
    // entry nothing consults it, and the module read as protection for as long
    // as nobody tested it.
    const source = read('app.module.ts');
    expect(source).toContain('APP_GUARD');
    expect(source).toContain('UserThrottlerGuard');
  });

  it('counts per student, not per address', () => {
    // Bucketing by IP puts a whole lab behind one limit: twenty students on
    // one institutional address get five requests a minute each, and a live
    // pair session spends more than that opening a workspace.
    const source = read('common/user-throttler.guard.ts');
    expect(source).toContain('getTracker');
    expect(source).toContain('req?.user?.userId');
    // Anonymous routes must still bucket by address - /auth/login has no user
    // yet, and there the address is the identity worth limiting.
    expect(source).toContain('req?.ip');
  });

  it('puts the endpoints where the request is the attack on a tighter bucket', () => {
    // Credential guessing, and compiling arbitrary Java.
    expect(read('modules/auth/auth.controller.ts')).toContain('@Throttle');
    expect(read('modules/code-runner/code-runner.controller.ts')).toContain('@Throttle');
  });
});
