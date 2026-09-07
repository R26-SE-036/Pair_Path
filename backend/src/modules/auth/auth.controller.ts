import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from '../../common/public.decorator';

/**
 * Ten requests a minute on everything here.
 *
 * /auth/login verifies a password, and /auth/exchange and /auth/refresh both
 * trade one credential for another - so an unlimited request rate is an
 * unlimited number of guesses. /auth/register is included because it is the
 * one endpoint that writes an account per request.
 */
@Controller('auth')
@Throttle({ default: { ttl: 60000, limit: 10 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
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
  @Public()
  @Post('exchange')
  async exchange(@Body('codeCoachAccessToken') codeCoachAccessToken: string) {
    return this.authService.exchange(codeCoachAccessToken);
  }

  @Public()
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
