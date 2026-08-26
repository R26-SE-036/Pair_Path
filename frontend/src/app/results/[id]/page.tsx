'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { io } from 'socket.io-client'
import api from '@/lib/api'
import type { ReviewResult } from '@/types'

export default function ResultsPage() {
  const params = useParams()
  const sessionId = params.id as string
  const [results, setResults] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchResults = useCallback(async () => {
    try {
      const { data } = await api.get(`/reviews/${sessionId}/result`)
      setResults(data)
    } catch (err) { console.error('Failed to fetch results:', err) }
    finally { setLoading(false) }
  }, [sessionId])

  useEffect(() => { fetchResults() }, [fetchResults])

  // Whoever submits first lands here before their partner has finished, so
  // this page must update when the second review arrives — otherwise it shows
  // a single score until the user manually refreshes.
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    const socket = io('http://localhost:3001', { auth: { token } })
    socket.on('connect', () => socket.emit('watch_session', { sessionId }))
    socket.on('review_submitted', () => { fetchResults() })

    return () => { socket.disconnect() }
  }, [sessionId, fetchResults])

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-accent-400'
    if (score >= 6) return 'text-yellow-400'
    if (score >= 4) return 'text-orange-400'
    return 'text-red-400'
  }

  const getScoreLabel = (score: number) => {
    if (score >= 8) return 'Excellent'
    if (score >= 6) return 'Good'
    if (score >= 4) return 'Fair'
    return 'Needs Improvement'
  }

  const getScoreBg = (score: number) => {
    if (score >= 8) return 'bg-accent-600/20 border-accent-500/30 text-accent-300'
    if (score >= 6) return 'bg-yellow-600/20 border-yellow-500/30 text-yellow-300'
    if (score >= 4) return 'bg-orange-600/20 border-orange-500/30 text-orange-300'
    return 'bg-red-600/20 border-red-500/30 text-red-300'
  }

  return (
    <div className="min-h-screen bg-surface-950">
      <nav className="bg-surface-900 border-b border-surface-700">
        <div className="max-w-4xl mx-auto px-4 flex justify-between h-14 items-center">
          <Link href="/dashboard" className="text-surface-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <h1 className="text-lg font-semibold text-white">Session Results</h1>
          <div />
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-8 px-4">
        {loading ? (
          <div className="text-center py-12"><p className="text-surface-400">Loading results...</p></div>
        ) : !results ? (
          <div className="text-center py-12">
            <p className="text-surface-400">No results available yet.</p>
            <Link href="/dashboard" className="mt-4 inline-block text-primary-400 hover:text-primary-300 text-sm">Back to Dashboard</Link>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            {/* Score Summary */}
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 text-center">
              <p className="text-sm text-surface-400 uppercase tracking-wide mb-2">Average Score</p>
              <div className={`text-6xl font-bold mb-2 ${getScoreColor(results.averageScore)}`}>
                {results.averageScore.toFixed(1)}
              </div>
              <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-medium border ${getScoreBg(results.averageScore)}`}>
                {getScoreLabel(results.averageScore)}
              </div>
            </div>

            {/* Individual Scores */}
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wide mb-4">Individual Reviews</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.reviews.map((review, i) => (
                  <div key={i} className="bg-surface-800 rounded-xl p-5 border border-surface-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-white font-medium">{review.firstName} {review.lastName}</h4>
                        <p className="text-xs text-surface-400 mt-1">Score: {review.score} / 10</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getScoreBg(review.score)}`}>
                        {getScoreLabel(review.score)}
                      </span>
                    </div>
                    {/* Score Bar */}
                    <div className="mt-3 w-full bg-surface-700 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all duration-1000 ${
                        review.score >= 8 ? 'bg-accent-500' : review.score >= 6 ? 'bg-yellow-500' : review.score >= 4 ? 'bg-orange-500' : 'bg-red-500'
                      }`} style={{ width: `${review.score * 10}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wide mb-4">Recommendations</h3>
              <div className="space-y-3">
                {results.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start space-x-3 bg-surface-800 rounded-xl p-4 border border-surface-700">
                    <span className="text-primary-400 mt-0.5">💡</span>
                    <p className="text-sm text-surface-300">{rec}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-center space-x-4">
              <Link href="/dashboard"
                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-all">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
