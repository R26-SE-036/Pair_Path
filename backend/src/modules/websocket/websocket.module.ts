import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WebsocketGateway } from './websocket.gateway';
import { CodeRunnerModule } from '../code-runner/code-runner.module';
import { MlModule } from '../ml/ml.module';
import { jwtSecret } from '../../common/env';

@Module({
  imports: [
    CodeRunnerModule,
    MlModule,
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { expiresIn: '24h' },
    }),
  ],
  // PrismaService comes from the global CommonModule. Listing it here created
  // a second client with its own connection pool - see health.module.ts.
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
