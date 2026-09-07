import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting per student, not per address.
 *
 * ==================== WHY THE DEFAULT IS WRONG HERE ====================
 * ThrottlerGuard buckets by IP. That is right for anonymous traffic and wrong
 * for everything else this API serves: a university lab, a hall of residence
 * or any institutional network puts every student behind one address, so a
 * hundred requests a minute is shared between all of them. Twenty students in
 * a lab get five requests each per minute, and a live pair session spends more
 * than that loading a single workspace.
 *
 * The failure would not look like rate limiting either. It arrives as a 429 in
 * the middle of somebody else's session, on an action that worked a moment
 * ago and will work again shortly - which reads as an intermittent fault, and
 * is the kind of thing that gets chased for a week.
 *
 * This was found by the integration suite: it drives several sessions from one
 * address and started failing on the twelfth, which is precisely the shape of
 * the problem a shared network would have.
 *
 * Anonymous routes still bucket by IP, and must: /auth/login has no user yet,
 * and it is the endpoint where the address IS the identity worth limiting.
 * ======================================================================
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.userId;
    if (userId) return `user:${userId}`;

    // `ips` is populated when the app trusts a proxy; `ip` otherwise. Behind a
    // load balancer without trust proxy set, every request appears to come
    // from the balancer - so a single-bucket fallback here would throttle the
    // whole deployment as one client.
    return `ip:${req?.ips?.length ? req.ips[0] : req?.ip}`;
  }
}
