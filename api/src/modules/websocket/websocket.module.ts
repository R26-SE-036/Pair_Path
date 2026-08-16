import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WebsocketGateway } from './websocket.gateway';
import { CodeRunnerModule } from '../code-runner/code-runner.module';
import { MlModule } from '../ml/ml.module';
import { PrismaService } from '../../common/prisma.service';

@Module({
  imports: [
    CodeRunnerModule,
    MlModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'pair-programming-secret',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [WebsocketGateway, PrismaService],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
