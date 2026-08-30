'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import type { PairSession } from '@/types'

export default function ReviewPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  const [session, setSession] = useState<PairSession | null>(null)
  const [phase, setPhase] = useState<'reading' | 'questions'>('reading')
  const [readingTimer, setReadingTimer] = useState(60)
  const [answers, setAnswers] = useState<Record<number, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.push('/login'); return }
    fetchSession()
  }, [sessionId, router])

  // Reading phase countdown
  useEffect(() => {
    if (phase !== 'reading') return
    const timer = setInterval(() => {
      setReadingTimer(prev => {
        if (prev <= 1) { setPhase('questions'); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  const fetchSession = async () => {
    try {
      const { data } = await api.get(`/reviews/${sessionId}`)
      setSession(data)
    } catch (err) { console.error('Failed to fetch session:', err) }
  }

  const handleAnswerChange = (index: number, value: boolean) => {
    setAnswers(prev => ({ ...prev, [index]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const reviewQuestions = session?.question?.reviewQuestions || []
    if (Object.keys(answers).length < reviewQuestions.length) {
      setError('Please answer all questions before submitting')
      return
    }
    setSubmitting(true); setError('')
    try {
      const orderedAnswers = reviewQuestions.map((_: string, i: number) => answers[i] ?? false)
      await api.post(`/reviews/${sessionId}/submit`, { answers: orderedAnswers })
      router.push(`/results/${sessionId}`)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit review')
      setSubmitting(false)
    }
  }

  const reviewQuestions = (session?.question?.reviewQuestions || []) as string[]

  return (
    <div className="min-h-screen bg-surface-950">
      <nav className="bg-surface-900 border-b border-surface-700">
        <div className="max-w-4xl mx-auto px-4 flex justify-between h-14 items-center">
          <Link href="/dashboard" className="text-surface-400 hover:text-surface-200 text-sm transition-colors">← Dashboard</Link>
          <h1 className="text-lg font-semibold text-surface-200">Session Review</h1>
          <div />
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-8 px-4">
        {!session ? (
          <div className="text-center py-12"><p className="text-surface-400">Loading session data...</p></div>
        ) : (
          <div className="space-y-6">
            {/* Question Card */}
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-surface-200 mb-2">{session.question?.title}</h3>
              <p className="text-sm text-surface-400 mb-4">{session.question?.description}</p>
              <div className="flex gap-2">
                {(session.question?.conceptTags as string[])?.map((tag: string, i: number) => (
                  <span key={i} className="text-xs bg-primary-600/20 text-primary-300 px-2 py-0.5 rounded">{tag}</span>
                ))}
              </div>
            </div>

            {/* Reference Solution */}
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
              <h4 className="text-sm font-semibold text-accent-400 uppercase tracking-wide mb-3">Reference Solution</h4>
              <pre className="bg-surface-800 rounded-xl p-4 text-sm font-mono text-surface-200 overflow-x-auto whitespace-pre-wrap border border-surface-700">
                {session.question?.referenceSolution || 'No reference solution available'}
              </pre>
            </div>

            {/* Reading Phase */}
            {phase === 'reading' && (
              <div className="bg-primary-600/10 border border-primary-500/30 rounded-2xl p-8 text-center animate-fade-in">
                <div className="text-4xl font-bold text-primary-300 mb-2">{readingTimer}s</div>
                <p className="text-primary-200 text-sm">Review the question and reference solution before answering</p>
                <button onClick={() => setPhase('questions')}
                  className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-all">
                  Skip to Questions →
                </button>
              </div>
            )}

            {/* Questions */}
            {phase === 'questions' && (
              <form onSubmit={handleSubmit} className="animate-fade-in">
                <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
                  <h4 className="text-sm font-semibold text-surface-400 uppercase tracking-wide mb-4">
                    Review Questions ({Object.keys(answers).length}/{reviewQuestions.length} answered)
                  </h4>

                  {error && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
                  )}

                  <div className="space-y-4">
                    {reviewQuestions.map((question: string, index: number) => (
                      <div key={index} className="bg-surface-800 rounded-xl p-4 border border-surface-700">
                        <p className="text-sm text-surface-200 mb-3">
                          <span className="text-primary-400 font-semibold mr-2">Q{index + 1}.</span>
                          {question}
                        </p>
                        <div className="flex space-x-4">
                          <label className="flex items-center cursor-pointer group">
                            <input type="radio" name={`q-${index}`} checked={answers[index] === true}
                              onChange={() => handleAnswerChange(index, true)}
                              className="w-4 h-4 text-accent-600 border-surface-600 focus:ring-accent-500 bg-surface-700" />
                            <span className="ml-2 text-sm text-surface-300 group-hover:text-surface-200 transition-colors">Yes</span>
                          </label>
                          <label className="flex items-center cursor-pointer group">
                            <input type="radio" name={`q-${index}`} checked={answers[index] === false}
                              onChange={() => handleAnswerChange(index, false)}
                              className="w-4 h-4 text-red-600 border-surface-600 focus:ring-red-500 bg-surface-700" />
                            <span className="ml-2 text-sm text-surface-300 group-hover:text-surface-200 transition-colors">No</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button type="submit" disabled={submitting}
                    className="mt-6 w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitting ? 'Submitting...' : 'Submit Review'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
