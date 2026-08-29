import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Single sign-on entry point: trade a Code Coach access token for a PairPath
   * one. The shared Code Guru portal signs the student in; the frontend calls
   * this on arrival. See AuthService.exchange for why PairPath issues its own
   * token rather than adopting Code Coach's.
   */
  @Post('exchange')
  async exchange(@Body('codeCoachAccessToken') codeCoachAccessToken: string) {
    return this.authService.exchange(codeCoachAccessToken);
  }

  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.userId);
  }
}
