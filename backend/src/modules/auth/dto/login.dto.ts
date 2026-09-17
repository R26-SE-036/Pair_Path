import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Login payload, matching the shared Code Coach backend:
 *
 *   { "identifier": "...", "password": "...", "client_name": "..." }
 *
 * `identifier` is deliberately NOT validated as an email — Code Coach accepts
 * a username too, and any address is now allowed rather than only SLIIT ones.
 * `email` is kept as an alias so older callers keep working.
 */
export class LoginDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  /** Legacy alias for `identifier`. */
  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @MinLength(6)
  password: string;

  /**
   * Accepted and ignored. Code Coach uses it to tell which client an auth
   * session came from; PairPath sends its own value from configuration.
   * Declared only so the global ValidationPipe — which runs with
   * forbidNonWhitelisted — does not reject a payload copied from the Code
   * Coach examples.
   */
  @IsOptional()
  @IsString()
  client_name?: string;
}
