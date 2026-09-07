/**
 * Telling PairPath's two tokens apart.
 *
 * ==================== WHY THEY HAVE TO BE TOLD APART ====================
 * Both were signed with the same secret and the same payload - `{ sub }` -
 * differing only in `expiresIn`. Nothing downstream could distinguish them, so
 * a refresh token was accepted everywhere an access token was:
 *
 *   - as a Bearer token by JwtStrategy, on every REST endpoint
 *   - as the handshake token by the Socket.IO gateway
 *
 * Which means the one-hour access lifetime bought nothing. The credential a
 * client actually holds for seven days was a fully valid API key for all seven
 * of them, and the short expiry it was paired with was decoration.
 *
 * The reverse direction was open too: an access token was accepted by
 * /auth/refresh and traded for a fresh pair, so a leaked access token could be
 * renewed indefinitely and never expired in practice.
 * =======================================================================
 */

export const ACCESS_TOKEN = 'access';
export const REFRESH_TOKEN = 'refresh';

export type TokenType = typeof ACCESS_TOKEN | typeof REFRESH_TOKEN;

/** What every token PairPath signs carries. */
export interface TokenPayload {
  sub: string;
  typ?: TokenType;
}

/**
 * May this token be used to act as its subject?
 *
 * A token with no `typ` is treated as an access token, not rejected. Tokens
 * issued before this field existed are still in circulation, and refusing them
 * would sign out everyone holding one - including in the middle of a live pair
 * session. The dangerous direction is closed either way: a token explicitly
 * marked `refresh` is refused, and every token minted from now on is marked.
 * The legacy tail is bounded by the seven-day refresh expiry.
 */
export function isAccessToken(payload: TokenPayload | undefined | null): boolean {
  return Boolean(payload?.sub) && payload?.typ !== REFRESH_TOKEN;
}

/** May this token be traded for a new pair? Explicit only - no legacy grace. */
export function isRefreshToken(payload: TokenPayload | undefined | null): boolean {
  return Boolean(payload?.sub) && payload?.typ === REFRESH_TOKEN;
}
