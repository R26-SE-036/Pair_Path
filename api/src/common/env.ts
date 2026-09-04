/**
 * Required configuration, checked once and loudly.
 *
 * ==================== WHY THIS EXISTS ====================
 * Four separate files read JWT_SECRET with the same fallback:
 *
 *     process.env.JWT_SECRET || 'pair-programming-secret'
 *
 * auth.module.ts, auth.service.ts, jwt.strategy.ts and websocket.module.ts.
 * With the variable unset, the API came up perfectly happily and signed every
 * token with a string that is committed to a public repository - so anyone
 * could mint a token for any user id, and the Socket.IO handshake would accept
 * it. Nothing in the boot output distinguished that from a correct setup.
 *
 * It is also four chances to drift. Change the fallback in three of the four
 * and the fourth still verifies against the old one, producing tokens that
 * pass in the REST layer and fail in the websocket handshake.
 *
 * ML_SERVICE_URL had a related problem, worse in a different way: it defaulted
 * to http://localhost:8000, which is Code Coach's port. Left unset, PairPath
 * quietly posted its feature vectors at the platform's identity provider and
 * fell back to a hardcoded PRODUCTIVE prediction when the response did not
 * parse - so the collaboration classifier was silently not running.
 * =========================================================
 */

/** Read a required variable, or explain what breaks without it. */
export function requireEnv(name: string, consequence: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not set. ${consequence}`);
  }
  return value.trim();
}

/**
 * The signing secret for PairPath's own tokens.
 *
 * PairPath issues its own JWT even when the identity came from Code Coach,
 * because the Socket.IO handshake verifies this signature and every foreign
 * key in the schema points at the local users.id. This secret is PairPath's
 * alone - it is not shared with Code Coach and must not be made to match it.
 */
export function jwtSecret(): string {
  return requireEnv(
    'JWT_SECRET',
    'It signs PairPath\'s own access tokens. There is deliberately no default: ' +
      'the previous fallback was a literal committed to this repository, which ' +
      'let anyone mint a token for any user.',
  );
}

/** Where the Python ML service lives. Must not be Code Coach's port. */
export function mlServiceUrl(): string {
  const url = requireEnv(
    'ML_SERVICE_URL',
    'The collaboration-state classifier is served there. It has no default ' +
      'because the previous one, http://localhost:8000, is Code Coach.',
  );

  if (/:8000(\/|$)/.test(url)) {
    throw new Error(
      `ML_SERVICE_URL is ${url}, and port 8000 belongs to Code Coach. ` +
        'PairPath\'s ml-service runs on 8020.',
    );
  }

  return url;
}

/**
 * Called once at startup so a missing variable is one clear message before the
 * server binds, rather than an exception from whichever module happened to
 * initialise first.
 */
export function assertRequiredEnv(): void {
  const problems: string[] = [];

  for (const check of [jwtSecret, mlServiceUrl]) {
    try {
      check();
    } catch (error) {
      problems.push(`  - ${(error as Error).message}`);
    }
  }

  // Not fatal. Redis is genuinely optional on one instance, and refusing to
  // start would make local development harder for no safety gain. Behind more
  // than one instance it is not optional at all: cooldowns fall back to a
  // per-process Map, so each instance keeps its own and a student receives the
  // same intervention once per instance.
  if (!process.env.REDIS_URL) {
    console.warn(
      '\n  WARNING: REDIS_URL is not set. Intervention cooldowns will use an\n' +
        '  in-memory fallback, which is per-process. Behind more than one API\n' +
        '  instance students will receive duplicate interventions.\n',
    );
  }

  if (problems.length) {
    throw new Error(
      `Refusing to start - required configuration is missing:\n${problems.join('\n')}\n`,
    );
  }
}
