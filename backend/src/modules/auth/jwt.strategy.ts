import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UnauthorizedException } from '@nestjs/common';
import { jwtSecret } from '../../common/env';
import { TokenPayload, isAccessToken } from '../../common/tokens';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  async validate(payload: TokenPayload) {
    // A refresh token is not a credential for acting as its subject. It was
    // accepted here, which is what made the access token's one-hour lifetime
    // meaningless - see common/tokens.ts.
    if (!isAccessToken(payload)) {
      throw new UnauthorizedException('This token cannot be used to authenticate a request.');
    }
    return { userId: payload.sub };
  }
}
