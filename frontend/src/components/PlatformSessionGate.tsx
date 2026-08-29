'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { adoptPlatformSession } from '@/lib/platform-session'

/**
 * Catches a session handed over by the Code Guru portal.
 *
 * The portal sends the student back to any page in the app with the Code Coach
 * tokens in the URL fragment. This runs app-wide, exchanges them for a PairPath
 * JWT once, and scrubs the fragment from the address bar.
 *
 * It only *adopts* a session; it does not guard routes. Pages keep their own
 * redirects, and api.ts still bounces a 401 back to /login.
 */
export default function PlatformSessionGate({ children }: { children: React.ReactNode }) {
  // Nothing to wait for unless a handoff is actually in the URL, so the app
  // renders immediately in the normal case.
  const [exchanging, setExchanging] = useState(
    () => typeof window !== 'undefined' && window.location.hash.includes('access_token='),
  )
  const [failed, setFailed] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false

    adoptPlatformSession().then((result) => {
      if (cancelled) return

      if (result === 'failed') {
        setFailed(true)
      } else if (result === 'adopted' && (pathname === '/login' || pathname === '/register')) {
        // Signed in via the portal but landed on a login page — send them on.
        router.replace('/dashboard')
      }

      setExchanging(false)
    })

    return () => {
      cancelled = true
    }
    // Runs once: a handoff fragment is consumed on arrival and never reappears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (exchanging) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <p className="text-surface-400">Signing you in to PairPath…</p>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-white mb-3">Could not sign you in</h1>
          <p className="text-surface-400 mb-6">
            Your Code Guru session could not be verified with PairPath. This usually means the
            Code Coach backend is unreachable.
          </p>
          <button
            onClick={() => router.replace('/login')}
            className="py-2.5 px-5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
