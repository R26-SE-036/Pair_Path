'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data } = await api.post('/auth/register', formData)
      localStorage.setItem('token', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      localStorage.setItem('user', JSON.stringify(data.user))
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">PairPath</h1>
          <p className="text-surface-400">Create your account</p>
        </div>

        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-6">Register</h2>

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
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
              </div>
              <div>
                <label htmlFor="reg-lastName" className="block text-sm font-medium text-surface-300 mb-1.5">Last Name</label>
                <input id="reg-lastName" name="lastName" type="text" required value={formData.lastName} onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-sm font-medium text-surface-300 mb-1.5">Email address</label>
              {/* Any address is accepted — the SLIIT-only rule was dropped when
                  PairPath moved onto the shared Code Coach identity service. */}
              <input id="reg-email" name="email" type="text" autoComplete="email" required value={formData.email} onChange={handleChange}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="you@example.com" />
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-sm font-medium text-surface-300 mb-1.5">Password</label>
              <input id="reg-password" name="password" type="password" autoComplete="new-password" required value={formData.password} onChange={handleChange}
                className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" />
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
