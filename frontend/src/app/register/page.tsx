'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { devLoginEnabled, redirectToPortal, register, saveTokens } from '@/lib/codeguru-auth.js'
import { CLIENT_NAME, CODE_COACH_URL, DEV_LOGIN_FLAG, PORTAL_URL } from '@/lib/codeguru-config'
import { exchangePlatformToken } from '@/lib/platform-session'

/**
 * PairPath registration.
 *
 * Deployed, this redirects to the shared Code Guru portal — one account is
 * created once, for the whole platform. On localhost with the dev-login flag
 * the form below renders, calling the same Code Coach endpoint with the same
 * fields the portal uses.
 *
 * The first/last name split is PairPath's own schema; Code Coach stores a
 * single `full_name`, so they are joined on the way out and split again on the
 * way back in (AuthService.linkOrCreateFromCodeCoach).
 */
export default function RegisterPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (devLoginEnabled(DEV_LOGIN_FLAG)) {
      setShowForm(true)
    } else {
      redirectToPortal(PORTAL_URL, {
        returnTo: window.location.origin + '/dashboard',
        path: '/register',
      })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const auth = await register(CODE_COACH_URL, {
        fullName: `${formData.firstName} ${formData.lastName}`.trim(),
        email: formData.email.trim(),
        password: formData.password,
        clientName: CLIENT_NAME,
      })
      saveTokens(auth)

      await exchangePlatformToken(auth.tokens.access_token)
      router.push('/dashboard')
    } catch (err: any) {
      setError(err?.message || err?.response?.data?.message || 'Registration failed')
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  if (!showForm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 py-12 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-surface-200 mb-2">PairPath</h1>
          <p className="text-surface-400">Taking you to Code Guru registration…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-surface-200 mb-2">PairPath</h1>
          <p className="text-surface-400">Create your account</p>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 shadow-xl">
          <div className="mb-6 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 text-xs font-medium">
            Localhost only — the deployed platform registers through the Code Guru portal
          </div>

          <h2 className="text-xl font-semibold text-surface-200 mb-6">Register</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-firstName" className="block text-sm font-medium text-surface-300 mb-1.5">First Name</label>
                <input id="reg-firstName" name="firstName" type="text" required value={formData.firstName} onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
              </div>
              <div>
                <label htmlFor="reg-lastName" className="block text-sm font-medium text-surface-300 mb-1.5">Last Name</label>
                <input id="reg-lastName" name="lastName" type="text" required value={formData.lastName} onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-sm font-medium text-surface-300 mb-1.5">Email address</label>
              {/* Any address is accepted — the SLIIT-only rule was dropped when
                  PairPath moved onto the shared Code Coach identity service. */}
              <input id="reg-email" name="email" type="text" autoComplete="email" required value={formData.email} onChange={handleChange}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="you@example.com" />
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-sm font-medium text-surface-300 mb-1.5">Password</label>
              <input id="reg-password" name="password" type="password" autoComplete="new-password" required value={formData.password} onChange={handleChange}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-surface-900">
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-surface-400">
            Already have an account?{' '}
            <Link href="/login" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
