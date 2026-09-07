import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { PrismaService } from '../../common/prisma.service';
import { Public } from '../../common/public.decorator';

/**
 * Is this service ready to answer?
 *
 * ==================== WHY READY, NOT ALIVE ====================
 * It queries the database, and fails when it cannot.
 *
 * "The process is up" is not the useful question here. PairPath runs against
 * Neon, which suspends a serverless Postgres after inactivity and takes several
 * seconds to wake - so the first request after a cold start can fail while the
 * container has been happily listening the whole time. That is exactly what
 * happened on the first `docker compose up`: the container reported itself
 * started at 17:53:21, Prisma logged
 *
 *     Can't reach database server at ...neon.tech:5432   errorCode: P1001
 *
 * and a student pressing Sign in five seconds later got a 503 that looked like
 * a fault. An orchestrator can only wait for readiness if something is willing
 * to say it is not ready yet.
 *
 * `SELECT 1` rather than a real query: it proves the connection pool can reach
 * the database without depending on any table existing, so a pending migration
 * does not make a healthy service look broken.
 * =============================================================
 */
@Controller('health')
@Public()
// Health is polled every few seconds by whatever is watching. Counting those
// against the caller's rate limit would eventually throttle the checker and
// make the service look unhealthy because it was being checked.
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'unreachable',
        detail: (error as Error)?.message?.split('\n')[0],
      });
    }

    return { status: 'ok', database: 'reachable' };
  }
}
