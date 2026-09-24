import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

// PrismaService comes from the global CommonModule. It used to be provided
// here too, which gave /health a connection pool of its own: the health check
// kept THAT pool busy every ten seconds while the pool serving real requests
// sat idle, so the container reported healthy about connections nothing else
// used - including while /pair hung on a stale one.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
