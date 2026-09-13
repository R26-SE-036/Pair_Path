/**
 * Connect to the database, waiting out a cold start instead of crashing.
 *
 * ================ WHY THE API RESTARTED ON BOOT ================
 * Neon suspends an idle database and takes a few seconds to wake it. The first
 * boot after a quiet period reached `$connect()` before it had: Prisma threw
 * P1001 ("Can't reach database server"), Nest's bootstrap rejected, and the
 * process exited. Docker restarted it and the second boot worked - but
 * `docker compose up --wait` had already watched the container die and refused
 * to start the web app that depends on it. On 13 September: first boot at
 * 18:50:28, P1001 at 18:50:34, a healthy second boot at 18:50:40.
 *
 * So a failure that means "the server cannot be reached YET" is retried, with
 * a doubling backoff and a log line per attempt, for about a minute. Anything
 * else - a wrong password, a database that does not exist - will not improve
 * with waiting, and is thrown at once.
 * ================================================================
 */

/** Unreachable, and timed out reaching. The two that waiting can fix. */
export const RETRYABLE_CONNECT_ERRORS = new Set(['P1001', 'P1002']);

export interface ConnectRetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, code: string) => void;
}

function errorCodeOf(error: unknown): string | undefined {
  // PrismaClientInitializationError carries `errorCode`; request errors carry
  // `code`. Either names the failure.
  const candidate = error as { errorCode?: unknown; code?: unknown } | null;
  const code = candidate?.errorCode ?? candidate?.code;
  return typeof code === 'string' ? code : undefined;
}

export async function connectWithRetry(
  connect: () => Promise<void>,
  options: ConnectRetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 8;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      await connect();
      return;
    } catch (error) {
      const code = errorCodeOf(error);
      if (!code || !RETRYABLE_CONNECT_ERRORS.has(code) || attempt >= attempts) throw error;

      const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      options.onRetry?.(attempt, delayMs, code);
      await sleep(delayMs);
    }
  }
}
