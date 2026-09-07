import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TopicsModule } from './modules/topics/topics.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { CodeRunnerModule } from './modules/code-runner/code-runner.module';
import { MlModule } from './modules/ml/ml.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { InterventionsModule } from './modules/interventions/interventions.module';

import { CommonModule } from './common/common.module';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';

@Module({
  imports: [
    CommonModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    /*
     * Rate limiting.
     *
     * ThrottlerModule was configured here and the guard was never registered,
     * so none of it did anything: `forRoot` only supplies the options, and
     * without an APP_GUARD entry nothing consults them. The configuration read
     * as protection for as long as nobody tested it, which is the worst state
     * for a security control to be in.
     *
     * ============ ONE BUCKET, NOT TWO ============
     * There were briefly two named buckets here, `default` at 100/min and
     * `strict` at 10/min, on the assumption that a route only counts against
     * the bucket it names. It counts against ALL of them: every named
     * throttler applies to every route unless explicitly skipped, so adding a
     * strict bucket for /auth and /code-runner capped the ENTIRE API at ten
     * requests a minute. A live workspace would have started returning 429
     * within seconds of a session opening.
     *
     * Nothing reported it. Both limits were configured plausibly, both were
     * being enforced, and the interaction between them is the bug. The
     * integration suite found it by making more than ten requests in a row -
     * which is what any real client does.
     *
     * So: one bucket, and the endpoints that need a tighter limit override it
     * by name with @Throttle({ default: ... }).
     * =============================================
     *
     * Counted PER STUDENT rather than per address - see
     * common/user-throttler.guard.ts.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    AuthModule,
    UsersModule,
    TopicsModule,
    QuestionsModule,
    SessionsModule,
    WebsocketModule,
    CodeRunnerModule,
    MlModule,
    ReviewsModule,
    InterventionsModule,
  ],
  providers: [
    /*
     * Order matters and is the whole point.
     *
     * Nest runs global guards in registration order, and all of them before
     * any route-level guard. The throttler reads `req.user` to bucket per
     * student; if the auth guard has not run yet there is no user, and it
     * silently falls back to bucketing a whole shared network as one client.
     *
     * Auth first also makes every route protected by default - see
     * common/public.decorator.ts.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
