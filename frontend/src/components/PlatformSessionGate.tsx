'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import {
  adoptPlatformSession,
  attemptExchange,
  clearAllSessions,
  AdoptResult,
} from '@/lib/platform-session'
import CodeGuruBar, { CodeGuruUser } from '@/components/CodeGuruBar'
import { PORTAL_URL } from '@/lib/codeguru-config'

/**
 * Who is signed in, for the platform bar.
 *
 * PairPath writes its own user under 'user' when it exchanges the platform
 * token; 'codeguru.user' is what the portal handed over. Either will do for a
 * name and initials, and neither is worth failing over.
 */
function readUser(): CodeGuruUser {
  if (typeof window === 'undefined') return null
  for (const key of ['user', 'codeguru.user']) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) return JSON.parse(raw)
    } catch {
      /* a corrupt entry just means no name in the bar */
    }
  }
  return null
}

type Status = 'resolving' | 'ready' | 'rejected' | 'unavailable'

/**
 * Take the access token out of the address bar.
 *
 * consumeHandoffFragment already calls history.replaceState, and in a plain
 * Vite app (Study Guider) that is the end of it. Next's App Router does its own
 * history work during hydration and puts the original URL back, fragment and
 * all — so the token sat visible in the address bar, and in browser history,
 * for the whole session. Scrubbing again once the router has settled is what
 * actually sticks.
 */
function scrubTokenFragment() {
  if (typeof window === 'undefined') return
  if (!window.location.hash.includes('access_token')) return

  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/**
 * Catches a session handed over by the Code Guru portal.
 *
 * The portal sends the student back to any page in the app with the Code Coach
 * tokens in the URL fragment. This runs app-wide, exchanges them for a PairPath
 * JWT once, and scrubs the fragment from the address bar.
 *
 * Nothing renders until that has resolved, and that is the important part.
 * This used to decide up front whether it had work to do:
 *
 *     useState(() => window.location.hash.includes('access_token='))
 *
 * which looks fine but is wrong under SSR. The initializer runs on the server,
 * where `window` does not exist, so it returned false — and React reuses the
 * server's state during hydration rather than re-running the initializer. The
 * children mounted immediately, the dashboard's own `if (!token) push('/login')`
 * fired before the exchange had even been sent, /login bounced to the portal,
 * and the student went round in circles while a perfectly good exchange was
 * still in flight.
 *
 * Starting at 'resolving' unconditionally means server and client agree, and
 * no page-level auth guard can run before the answer is known.
 */
export default function PlatformSessionGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('resolving')
  const router = useRouter()
  const pathname = usePathname()

  const apply = useCallback(
    (result: AdoptResult) => {
      if (result === 'rejected') return setStatus('rejected')
      if (result === 'unavailable') return setStatus('unavailable')

      // 'adopted' on a login page means they came back from the portal and
      // should not be looking at a sign-in form any more.
      if (result === 'adopted' && (pathname === '/login' || pathname === '/register')) {
        router.replace('/dashboard')
      }
      setStatus('ready')
    },
    [pathname, router],
  )

  useEffect(() => {
    let cancelled = false
    adoptPlatformSession().then((result) => {
      if (cancelled) return
      scrubTokenFragment()
      apply(result)
    })
    return () => {
      cancelled = true
    }
    // Runs once per page load: a handoff fragment is consumed on arrival and
    // never reappears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Retry without another portal round trip — the platform token is still stored. */
  async function retry() {
    setStatus('resolving')
    apply(await attemptExchange())
  }

  if (status === 'resolving') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <p className="text-surface-400">Signing you in to PairPath…</p>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-surface-200 mb-3">PairPath is not responding</h1>
          <p className="text-surface-400 mb-2">
            You are signed in to Code Guru, but PairPath&apos;s own server did not answer, so it
            could not start your session here.
          </p>
          <p className="text-surface-500 text-sm mb-6">
            It usually means the PairPath API is not running. Your login is fine — no need to
            sign in again.
          </p>
          <button
            onClick={retry}
            className="py-2.5 px-5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-surface-200 mb-3">Your session has expired</h1>
          <p className="text-surface-400 mb-6">
            Code Guru could not verify your login, so you will need to sign in again.
          </p>
          <button
            onClick={() => router.replace('/login')}
            className="py-2.5 px-5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-all"
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <CodeGuruBar
        service="pairpath"
        portalUrl={PORTAL_URL}
        user={readUser()}
        onSignOut={() => {
          clearAllSessions()
          window.location.href = PORTAL_URL.replace(/\/+$/, '') + '/login'
        }}
      />
      {children}
    </>
  )
}
