import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CodeCoachService } from './code-coach.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly codeCoach: CodeCoachService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Any valid email address is accepted. The previous SLIIT-only rule was
    // removed when PairPath moved onto the shared Code Coach identity service,
    // whose accounts are not restricted to one domain.

    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const { firstName, lastName, fullName } = this.resolveName(registerDto);

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user. Fields are listed explicitly rather than spread, so a
    // client cannot smuggle extra columns (notably codeCoachUserId) through
    // the request body.
    let user = await this.usersService.create({
      email: registerDto.email,
      password: hashedPassword,
      firstName,
      lastName,
    });

    // Mirror the account into Code Coach so it works across every component of
    // the platform. Deliberately best-effort: if the service is down or the
    // email is already registered there, the local account is still valid and
    // the link is established on the user's next login instead.
    const remote = await this.codeCoach.register(
      fullName,
      registerDto.email,
      registerDto.password,
    );
    if (remote) {
      user = await this.usersService.linkCodeCoachId(user.id, remote.userId);
    }

    return this.authResponse(user, remote ? 'code-coach' : 'local');
  }

  /**
   * Two identity sources, tried in order.
   *
   * 1. The shared Code Coach backend, so accounts work across every component
   *    of the platform. On success the user is provisioned locally if this is
   *    their first PairPath login.
   * 2. The local users table, which keeps existing accounts (including the
   *    seeded demo pair) working and covers the case where Code Coach is
   *    unreachable — its tunnel is not always up.
   *
   * Either way PairPath issues its own JWT. Everything downstream — the
   * WebSocket handshake, session membership, foreign keys — depends on the
   * local user id, so that never changes.
   */
  async login(loginDto: LoginDto) {
    // Code Coach calls it `identifier`; older PairPath clients send `email`.
    const identifier = (loginDto.identifier || loginDto.email || '').trim();
    if (!identifier) {
      throw new BadRequestException('identifier (or email) is required');
    }

    const remote = await this.codeCoach.login(identifier, loginDto.password);
    if (remote) {
      const user = await this.linkOrCreateFromCodeCoach(remote);
      return this.authResponse(user, 'code-coach');
    }

    const user = await this.usersService.findByEmail(identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authResponse(user, 'local');
  }

  /**
   * Find the local row for a Code Coach identity, creating it on first login.
   *
   * Matching is by Code Coach user id first, then by email — so an account
   * that already existed locally is adopted rather than duplicated, which
   * matters because every session and event ever recorded points at that
   * existing row.
   */
  private async linkOrCreateFromCodeCoach(remote: {
    userId: string;
    email: string;
    fullName: string;
  }) {
    const linked = await this.usersService.findByCodeCoachId(remote.userId);
    if (linked) return linked;

    const existing = await this.usersService.findByEmail(remote.email);
    if (existing) {
      return this.usersService.linkCodeCoachId(existing.id, remote.userId);
    }

    const [firstName, ...rest] = (remote.fullName || remote.email.split('@')[0]).trim().split(/\s+/);
    return this.usersService.create({
      email: remote.email,
      // No local password: this account authenticates through Code Coach. A
      // random hash keeps the column non-null while guaranteeing the local
      // bcrypt comparison can never succeed.
      password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
      firstName: firstName || 'Student',
      lastName: rest.join(' ') || '',
      codeCoachUserId: remote.userId,
    });
  }

  /**
   * Produce firstName, lastName and fullName from whichever the caller sent.
   *
   * The users table stores the name split in two, while Code Coach expects a
   * single full_name — so one shape always has to be derived from the other.
   * Everything after the first space becomes the last name, which keeps
   * multi-word surnames intact.
   */
  private resolveName(dto: RegisterDto) {
    const first = (dto.firstName || '').trim();
    const last = (dto.lastName || '').trim();
    if (first || last) {
      return { firstName: first, lastName: last, fullName: `${first} ${last}`.trim() };
    }

    const combined = (dto.fullName || dto.full_name || '').trim();
    if (!combined) {
      throw new BadRequestException('firstName (or full_name) is required');
    }
    const [head, ...rest] = combined.split(/\s+/);
    return { firstName: head, lastName: rest.join(' '), fullName: combined };
  }

  private async authResponse(
    user: { id: string; email: string; firstName: string; lastName: string },
    authSource: 'code-coach' | 'local',
  ) {
    const tokens = await this.generateTokens(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      authSource,
      ...tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_SECRET || 'pair-programming-secret',
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user.id);
      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  private async generateTokens(userId: string) {
    const payload = { sub: userId };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
    };
  }
}
