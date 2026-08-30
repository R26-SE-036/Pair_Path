'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { devLoginEnabled, login, redirectToPortal, saveTokens } from '@/lib/codeguru-auth.js'
import { CLIENT_NAME, CODE_COACH_URL, DEV_LOGIN_FLAG, PORTAL_URL } from '@/lib/codeguru-config'
import { exchangePlatformToken } from '@/lib/platform-session'

/**
 * PairPath sign-in.
 *
 * Code Guru has one login surface: the shared portal. In a deployed build this
 * page does nothing but send the student there and let the portal hand the
 * session back.
 *
 * On localhost with NEXT_PUBLIC_ENABLE_DEV_LOGIN set, the form below renders
 * instead so PairPath can be worked on without running the portal alongside
 * it. It is not a second implementation: it calls the same Code Coach
 * endpoints with the same fields, then exchanges the result for a PairPath
 * token exactly as the portal handoff does. Only the hosting differs.
 *
 * What changed: this page used to collect the password and post it to
 * PairPath's own /auth/login, which forwarded it to Code Coach and threw the
 * returned tokens away. Accounts were linked but the student still had a
 * separate login here, and PairPath held no platform token.
 */
export default function LoginPage() {
  // Named `identifier` to match the shared Code Coach backend, which accepts
  // a username as well as an email address.
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (devLoginEnabled(DEV_LOGIN_FLAG)) {
      setShowForm(true)
    } else {
      redirectToPortal(PORTAL_URL, { returnTo: window.location.origin + '/dashboard' })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Straight to Code Coach — the same call the portal makes.
      const auth = await login(CODE_COACH_URL, {
        identifier: identifier.trim(),
        password,
        clientName: CLIENT_NAME,
      })
      saveTokens(auth)

      // Then trade the platform token for a PairPath one, because the
      // Socket.IO handshake and every foreign key need the local user id.
      await exchangePlatformToken(auth.tokens.access_token)

      router.push('/dashboard')
    } catch (err: any) {
      setError(err?.message || err?.response?.data?.message || 'Invalid credentials')
      setLoading(false)
    }
  }

  if (!showForm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 py-12 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-surface-200 mb-2">PairPath</h1>
          <p className="text-surface-400">Taking you to the Code Guru sign-in…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-surface-200 mb-2">PairPath</h1>
          <p className="text-surface-400">Collaborative Pair Programming Platform</p>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 shadow-xl">
          <div className="mb-6 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 text-xs font-medium">
            Localhost only — the deployed platform signs in through the Code Guru portal
          </div>

          <h2 className="text-xl font-semibold text-surface-200 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="login-identifier" className="block text-sm font-medium text-surface-300 mb-1.5">
                Email or username
              </label>
              <input
                id="login-identifier"
                name="identifier"
                // type="text", not "email": the backend accepts a username too,
                // and the browser's own email check would block a valid one
                // before the form was ever submitted.
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-surface-300 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-surface-900"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-surface-400">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
