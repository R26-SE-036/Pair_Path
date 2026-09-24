/**
 * The database URL the API connects with, with time limits added.
 *
 * ================= WHY THE PAIR PAGE LOADED FOREVER =================
 * Prisma puts no limit on how long a query may wait for the database to answer.
 * Everything else PairPath waits on is bounded - Code Coach calls time out at
 * 8 s - so a pooled connection that died while idle was the one thing that
 * could hang a request with no end. The query sat on a socket nothing would
 * ever answer until the operating system gave up on it, which on Linux is many
 * minutes. The /pair page asks for topics before it shows anything, so it said
 * "Loading..." for as long as that took, after the student had been signed in
 * a while, while every other page worked.
 *
 * `socket_timeout` makes such a query fail instead, and Prisma discards the
 * broken connection so the next query opens a good one. `connect_timeout` does
 * the same for a connection that cannot be opened. Both are only added when the
 * URL does not already set them, so an operator can still choose.
 * ======================================================================
 */

/** Seconds. PairPath's queries are single-row lookups; 15 s is a failure, not a slow query. */
export const DATABASE_TIME_LIMITS: Readonly<Record<string, string>> = Object.freeze({
  socket_timeout: '15',
  connect_timeout: '10',
});

export function withTimeLimits(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    // Not ours to diagnose - Prisma reports a malformed URL better than this can.
    return url;
  }

  for (const [name, value] of Object.entries(DATABASE_TIME_LIMITS)) {
    if (!parsed.searchParams.has(name)) parsed.searchParams.set(name, value);
  }
  return parsed.toString();
}
