import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

/**
 * Intervention cooldowns.
 *
 * ======================= WHAT THIS USED TO BE =======================
 * Eleven methods: session state, user presence, collaboration metrics and an
 * event log, alongside the two below. Nothing called any of the other nine.
 * Session state is in PostgreSQL, presence is the Socket.IO room, metrics are
 * derived by the feature extractor, and the event log duplicated
 * session_events - so each one was a second, divergent home for something
 * that already had one. `incrementMetric` even issued N separate INCRs in a
 * loop instead of one INCRBY, which is the kind of thing that survives only
 * in code nobody runs.
 * ====================================================================
 *
 * What remains is the one thing Redis is actually needed for, and it is needed
 * for a specific reason: the cooldown has to be SHARED. Behind more than one
 * API instance the in-memory fallback gives each process its own, so a student
 * receives the same nudge once per instance. That is why assertRequiredEnv()
 * warns when REDIS_URL is unset rather than treating it as a free choice.
 */

/** How long one intervention type stays silent after firing, per session. */
const COOLDOWN_SECONDS = 300;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private isConnected = false;

  /**
   * The fallback. Per-process and therefore wrong behind more than one
   * instance - deliberately kept anyway, because refusing to run without
   * Redis would make local development harder for no safety gain.
   */
  private memoryStore = new Map<string, NodeJS.Timeout>();

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      // No default. The old one was redis://localhost:6379, which meant a
      // machine happening to run Redis on that port got silently wired to it.
      this.logger.warn('REDIS_URL is not set; intervention cooldowns are per-process.');
      return;
    }

    try {
      this.client = createClient({
        url,
        socket: {
          connectTimeout: 5000,
          // Three attempts, then stop. An unreachable Redis should not fill
          // the log with reconnect noise for the life of the process.
          reconnectStrategy: (retries) => (retries > 3 ? false : 1000),
        },
      }) as RedisClientType;

      // Swallowed on purpose: a connection error here is already reported by
      // the catch below or by the reconnect strategy giving up, and an
      // unhandled 'error' event would take the process down.
      this.client.on('error', () => {});

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connection timeout')), 5000),
        ),
      ]);

      this.isConnected = true;
      this.logger.log('Connected; intervention cooldowns are shared across instances.');
    } catch (error) {
      this.isConnected = false;
      this.logger.warn(
        `Could not reach Redis (${(error as Error).message}); ` +
          'intervention cooldowns are per-process.',
      );
    }
  }

  async onModuleDestroy() {
    // Clear the fallback's timers too, or a test process hangs on an open
    // handle for up to five minutes after the last intervention.
    for (const timer of this.memoryStore.values()) clearTimeout(timer);
    this.memoryStore.clear();

    if (this.isConnected) await this.client.disconnect();
  }

  private key(sessionId: string, interventionType: string): string {
    return `session:${sessionId}:intervention:${interventionType}`;
  }

  /** True when this intervention type has not fired recently in this session. */
  async canShowIntervention(sessionId: string, interventionType: string): Promise<boolean> {
    const key = this.key(sessionId, interventionType);
    if (this.isConnected) return (await this.client.get(key)) === null;
    return !this.memoryStore.has(key);
  }

  /** Start the cooldown for one intervention type in one session. */
  async setInterventionCooldown(sessionId: string, interventionType: string): Promise<void> {
    const key = this.key(sessionId, interventionType);

    if (this.isConnected) {
      await this.client.set(key, '1', { EX: COOLDOWN_SECONDS });
      return;
    }

    // unref() so a pending cooldown never holds the process open on shutdown.
    const timer = setTimeout(() => this.memoryStore.delete(key), COOLDOWN_SECONDS * 1000);
    timer.unref?.();
    this.memoryStore.set(key, timer);
  }
}
