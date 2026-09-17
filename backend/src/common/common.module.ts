import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

// MongoDbService was here. It held an analytics trail that duplicated
// PostgreSQL: of its eleven methods only two were ever called, both
// write-only, and nothing in the codebase read any of it back. The one piece
// of data that was NOT duplicated - the feature/prediction pairs kept for
// human labeling - now goes to feature_windows and pair_state_predictions,
// which were in the Prisma schema from the start and had never been written
// to. See websocket.gateway.ts.
@Global()
@Module({
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class CommonModule {}
