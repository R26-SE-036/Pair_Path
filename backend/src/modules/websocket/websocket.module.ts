import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WebsocketGateway } from './websocket.gateway';
import { CodeRunnerModule } from '../code-runner/code-runner.module';
import { MlModule } from '../ml/ml.module';
import { PrismaService } from '../../common/prisma.service';
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
  providers: [WebsocketGateway, PrismaService],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
