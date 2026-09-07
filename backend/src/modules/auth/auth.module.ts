import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CodeCoachService } from './code-coach.service';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { jwtSecret } from '../../common/env';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    HttpModule,
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CodeCoachService, JwtStrategy],
  exports: [AuthService, CodeCoachService],
})
export class AuthModule {}
