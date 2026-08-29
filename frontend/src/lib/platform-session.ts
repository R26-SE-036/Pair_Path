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

/** True when PairPath already has its own session. */
export function hasPairPathSession(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(localStorage.getItem('token'))
}

/**
 * Exchange a Code Coach access token for a PairPath one and store it.
 *
 * Throws if the platform token cannot be exchanged — the caller decides
 * whether that means "send them back to the portal" or "show an error".
 */
export async function exchangePlatformToken(codeCoachAccessToken: string) {
  const { data } = await api.post('/auth/exchange', { codeCoachAccessToken })

  localStorage.setItem('token', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)
  localStorage.setItem('user', JSON.stringify(data.user))

  return data.user
}

/**
 * Adopt a session handed over by the portal, if there is one in the URL.
 *
 * Returns 'adopted' when a platform handoff was consumed and exchanged,
 * 'existing' when PairPath was already signed in, 'none' when there is
 * nothing to do, and 'failed' when a handoff arrived but could not be
 * exchanged.
 */
export async function adoptPlatformSession(): Promise<
  'adopted' | 'existing' | 'none' | 'failed'
> {
  const handedOff = consumeHandoffFragment()

  if (!handedOff) {
    return hasPairPathSession() ? 'existing' : 'none'
  }

  const { accessToken } = loadTokens()
  if (!accessToken) return 'failed'

  try {
    await exchangePlatformToken(accessToken)
    return 'adopted'
  } catch {
    // The platform token was rejected or Code Coach was unreachable. Drop it
    // rather than leaving a half-session behind that looks signed in.
    clearTokens()
    return 'failed'
  }
}

/** Clear both the PairPath session and the platform one. */
export function clearAllSessions() {
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  clearTokens()
}
