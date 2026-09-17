import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Registration payload, matching the shared Code Coach backend:
 *
 *   { "email": "...", "password": "...", "full_name": "...", "client_name": "..." }
 *
 * The PairPath form collects first and last name separately — better UX, and
 * the users table stores them apart — so both shapes are accepted and the
 * service joins or splits whichever arrived. Any valid email address is
 * allowed; the old SLIIT-only restriction has been removed.
 */
export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /** Code Coach shape. */
  @IsOptional()
  @IsString()
  full_name?: string;

  /** camelCase equivalent of full_name. */
  @IsOptional()
  @IsString()
  fullName?: string;

  /** What the PairPath register form actually sends. */
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  /** Accepted and ignored — see LoginDto. */
  @IsOptional()
  @IsString()
  client_name?: string;
}
