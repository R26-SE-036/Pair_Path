import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Throttle } from '@nestjs/throttler';
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
  //
  // Its own, much higher limit. Every call arrives from the web app's server,
  // so the per-IP bucket above was one bucket for the whole platform: ten
  // sign-ins a minute, and the eleventh student could not pair. There is also
  // nothing here to guess - the caller must present a Code Coach token that
  // Code Coach itself verifies.
  @Throttle({ default: { ttl: 60000, limit: 600 } })
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
}
