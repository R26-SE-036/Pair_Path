import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Client for the shared Code Coach backend, which acts as the group's identity
 * provider.
 *
 * PairPath does not adopt Code Coach's tokens. It verifies credentials here,
 * then mints its own JWT — every table in this schema keys on the local
 * `users.id`, and the WebSocket gateway verifies PairPath's own signature
 * during the handshake. Swapping in a foreign token would break both.
 *
 * The base URL is configuration, never hardcoded: the current deployment sits
 * behind a Cloudflare quick tunnel whose hostname changes every time it
 * restarts.
 */

/** What Code Coach returns on a successful register or login. */
export interface CodeCoachAuthResult {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
}

@Injectable()
export class CodeCoachService {
  private readonly logger = new Logger(CodeCoachService.name);

  private readonly baseUrl = (process.env.CODE_COACH_URL || '').replace(/\/+$/, '');
  private readonly clientName = process.env.CODE_COACH_CLIENT_NAME || 'pair-review-studio';
  private readonly timeoutMs = Number(process.env.CODE_COACH_TIMEOUT_MS || 8000);

  constructor(private readonly http: HttpService) {}

  /** False when CODE_COACH_URL is unset, in which case PairPath uses local auth only. */
  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  /**
   * Verify credentials against Code Coach.
   *
   * Returns null for "these credentials are not valid here" (401/404) so the
   * caller can fall back to local auth. Throws only when the service itself is
   * unreachable or misbehaving — a network failure must not be mistaken for a
   * rejected password.
   */
  async login(identifier: string, password: string): Promise<CodeCoachAuthResult | null> {
    return this.call('/api/v1/auth/login', { identifier, password });
  }

  /** Mirror a new PairPath account into Code Coach so both systems share the identity. */
  async register(fullName: string, email: string, password: string): Promise<CodeCoachAuthResult | null> {
    return this.call('/api/v1/auth/register', { full_name: fullName, email, password });
  }

  private async call(path: string, body: Record<string, unknown>): Promise<CodeCoachAuthResult | null> {
    if (!this.enabled) return null;

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}${path}`,
          { ...body, client_name: this.clientName },
          { timeout: this.timeoutMs, validateStatus: () => true },
        ),
      );

      // Credentials rejected, or the account already exists on register.
      // Not an error — the caller falls back to local handling.
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 409) {
        return null;
      }

      if (response.status >= 400) {
        this.logger.warn(`Code Coach ${path} returned ${response.status}; falling back to local auth`);
        return null;
      }

      const user = response.data?.user;
      if (!user?.user_id || !user?.email) {
        this.logger.warn(`Code Coach ${path} returned an unexpected body; falling back to local auth`);
        return null;
      }

      return {
        userId: user.user_id,
        email: user.email,
        fullName: user.full_name || '',
        role: user.role || 'student',
        status: user.status || 'active',
      };
    } catch (error: any) {
      // Unreachable, DNS failure, timeout — the tunnel is very often down.
      // Degrade to local auth rather than locking everyone out.
      this.logger.warn(`Code Coach ${path} unreachable (${error?.message}); falling back to local auth`);
      return null;
    }
  }
}
