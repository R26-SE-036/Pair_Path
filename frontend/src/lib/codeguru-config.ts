/**
 * Code Guru platform configuration for the PairPath frontend.
 *
 * codeguru-auth.js takes its configuration as arguments so it can stay
 * identical to the master copy in the code-coach repo. This module is the
 * Next-specific half that feeds it.
 */

/** Code Coach — the platform's identity provider. */
export const CODE_COACH_URL =
  process.env.NEXT_PUBLIC_CODE_COACH_URL || 'http://127.0.0.1:8000';

/** The shared login UI. A student with no session is sent here. */
export const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:4200';

/** Enables the localhost-only login form. Ignored unless served from localhost. */
export const DEV_LOGIN_FLAG = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN;

/** Identifies this client on the Code Coach auth session. */
export const CLIENT_NAME = 'pair-review-studio';

/**
 * Where PairPath keeps the Code Coach access token.
 *
 * Separate from `token`, which is PairPath's OWN JWT and the only thing its
 * API and Socket.IO gateway accept. Keeping the platform token as well means
 * PairPath can later call Code Coach's /api/v1/collaboration/me/* endpoints on
 * the student's behalf — it could not before, because login threw those
 * tokens away.
 */
export const PLATFORM_TOKEN_KEY = 'codeguru.accessToken';
