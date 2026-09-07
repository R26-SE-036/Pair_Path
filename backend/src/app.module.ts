import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    CommonModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
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
})
export class AppModule {}
