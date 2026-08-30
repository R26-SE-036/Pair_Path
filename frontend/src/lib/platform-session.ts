/**
 * Turning a Code Guru platform session into a PairPath session.
 *
 * The shared portal signs a student in once and sends them back here with the
 * Code Coach tokens in the URL fragment. PairPath does not use that token
 * directly — its Socket.IO handshake verifies PairPath's own signature and
 * every foreign key points at the local `users.id` — so it trades it for a
 * PairPath JWT via POST /auth/exchange.
 *
 * See api/src/modules/auth/auth.service.ts (exchange) for the server half.
 */

import api from './api'
import { consumeHandoffFragment, loadTokens, clearTokens } from './codeguru-auth.js'

/**
 * How an attempt to establish a PairPath session ended.
 *
 * `rejected` and `unavailable` are kept apart on purpose. Collapsing them was a
 * real bug: a PairPath API that was simply down got treated as "your login is
 * bad", the platform token was thrown away, and the student was bounced back to
 * the portal to sign in again — which produced another token that failed the
 * same way. An endless loop caused by a service being offline for a moment.
 */
export type AdoptResult =
  | 'adopted' // exchanged a platform token for a PairPath one just now
  | 'existing' // already had a PairPath session
  | 'none' // not signed in anywhere; the page's own guard should redirect
  | 'rejected' // PairPath refused the platform token — it really is no good
  | 'unavailable' // could not reach PairPath — the token is fine, retry later

/** True when PairPath already has its own session. */
export function hasPairPathSession(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(localStorage.getItem('token'))
}

/**
 * Exchange a Code Coach access token for a PairPath one and store it.
 * Throws on failure; callers use `attemptExchange` for the classified result.
 */
export async function exchangePlatformToken(codeCoachAccessToken: string) {
  const { data } = await api.post('/auth/exchange', { codeCoachAccessToken })

  localStorage.setItem('token', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)
  localStorage.setItem('user', JSON.stringify(data.user))

  return data.user
}

/**
 * Trade the stored platform token for a PairPath one.
 *
 * Exported so the "try again" button can retry without sending the student
 * back through the portal — the platform token is still in storage, and a
 * failed exchange is usually PairPath restarting, not a bad login.
 */
export async function attemptExchange(): Promise<AdoptResult> {
  const { accessToken } = loadTokens()
  if (!accessToken) return 'none'

  try {
    await exchangePlatformToken(accessToken)
    return 'adopted'
  } catch (error: any) {
    const status = error?.response?.status

    // 401/403 is PairPath saying it checked with Code Coach and the answer was
    // no. That token will never work, so drop it and make them sign in again.
    if (status === 401 || status === 403) {
      clearTokens()
      return 'rejected'
    }

    // Anything else — no response at all (API down), a 503 because Code Coach
    // was unreachable from the server, a 500 — is not the student's fault.
    // KEEP the platform token so a retry costs nothing.
    return 'unavailable'
  }
}

/**
 * Work out what session this page load has, adopting a portal handoff if there
 * is one in the URL.
 *
 * Also covers the awkward middle state: a platform token in storage but no
 * PairPath token, which is what a previously failed exchange leaves behind.
 * Retrying it here is what stops that state becoming permanent.
 */
export async function adoptPlatformSession(): Promise<AdoptResult> {
  const handedOff = consumeHandoffFragment()

  if (handedOff) return attemptExchange()
  if (hasPairPathSession()) return 'existing'

  // No handoff and no PairPath session — but maybe a platform token survived a
  // failed attempt. If so, finish the job; otherwise we are simply signed out.
  return loadTokens().accessToken ? attemptExchange() : 'none'
}

/** Clear both the PairPath session and the platform one. */
export function clearAllSessions() {
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  clearTokens()
}
