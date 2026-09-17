import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/**
 * Reachable without a token.
 *
 * ==================== WHY AUTH IS GLOBAL NOW ====================
 * Two reasons, and the second is the one that forced it.
 *
 * Closed by default. Every controller carried its own
 * `@UseGuards(JwtAuthGuard)`, so a new one added without that line is wide
 * open and nothing says so - which is how GET /users came to hand out every
 * account in the system. Making the guard global inverts it: a route is
 * protected unless somebody writes down that it should not be, and that
 * decision is visible in the diff.
 *
 * And rate limiting could not see who was asking. Nest runs global guards
 * before route-level ones, so a global ThrottlerGuard reading `req.user` found
 * nothing - the JWT guard had not run yet - and silently fell back to
 * bucketing every student on a shared network into one limit. Ordering the
 * auth guard first is what makes per-student throttling possible at all.
 * ================================================================
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
