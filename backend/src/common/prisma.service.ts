import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma, with optional connection pooling.
 *
 * Two connection strings are in play when running on Neon:
 *
 *   DATABASE_URL         the direct connection. Used by `prisma migrate`, and
 *                        the only one an older .env is guaranteed to have.
 *   DATABASE_URL_POOLED  the pooled connection. Optional.
 *
 * The pooled URL is applied HERE rather than in schema.prisma on purpose.
 * Naming it in the schema makes it mandatory - Prisma refuses to load at all if
 * the variable is missing - which broke every teammate who pulled the code and
 * kept their own .env. Choosing it at runtime means a .env with only
 * DATABASE_URL behaves exactly as it always did, while anyone who has
 * configured the pooler gets it.
 *
 * Why pooling matters on Neon: it caps direct connections well below what a
 * NestJS app holds open, so without the pooler the app starts fine and then
 * fails once a few students are on at once.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const pooled = process.env.DATABASE_URL_POOLED?.trim();
    super(pooled ? { datasources: { db: { url: pooled } } } : {});
  }

  async onModuleInit() {
    this.logger.log(
      process.env.DATABASE_URL_POOLED?.trim()
        ? 'Connecting through the pooled database URL'
        : 'Connecting through DATABASE_URL (set DATABASE_URL_POOLED to use a pooler)',
    );
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
