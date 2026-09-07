import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
     * without an APP_GUARD entry (or a @UseGuards somewhere) nothing consults
     * them. The configuration read as protection for as long as nobody tested
     * it, which is the worst state for a security control to be in.
     *
     * Two buckets. The default is generous because a live pair session is
     * chatty over REST as well as the socket. `strict` is for the endpoints
     * where the request itself is the attack - credential guessing on
     * /auth/login, and compiling arbitrary Java on /code-runner.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 100 },
      { name: 'strict', ttl: 60000, limit: 10 },
    ]),
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
    // The line that makes the configuration above mean something.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
