import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * No controller.
 *
 * UsersController exposed three routes behind JwtAuthGuard and nothing else:
 *
 *   GET  /users      every account in the system - id, email, name, created -
 *                    to any signed-in student. A directory of everyone's email
 *                    address, for no feature that asks for one.
 *   GET  /users/:id  the same, one at a time, returning the RAW row including
 *                    the bcrypt password hash.
 *   POST /users      account creation with no password hashing and no identity
 *                    check, in parallel with /auth/register which does both.
 *
 * Nothing called any of them. They come back with a role model, if an
 * instructor-facing surface ever needs them.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
