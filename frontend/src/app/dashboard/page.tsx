'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import type { User, Topic, Question, PairSession } from '@/types'

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState<string>('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedQuestion, setSelectedQuestion] = useState<string>('')
  const [sessions, setSessions] = useState<PairSession[]>([])
  const [joinCode, setJoinCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/login'); return }
    if (userData) setUser(JSON.parse(userData))
    fetchTopics()
    fetchMySessions()
  }, [router])

  const fetchTopics = async () => {
    try {
      const { data } = await api.get('/topics')
      setTopics(data)
    } catch (err) { console.error('Failed to fetch topics:', err) }
  }

  const fetchMySessions = async () => {
    try {
      setLoadingSessions(true)
      const { data } = await api.get('/sessions/my')
      setSessions(data)
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setLoadingSessions(false)
    }
  }

  const handleTopicChange = async (topicId: string) => {
    setSelectedTopic(topicId)
    setSelectedQuestion('')
    if (!topicId) { setQuestions([]); return }
    try {
      const { data } = await api.get(`/questions/topic/${topicId}`)
      setQuestions(data)
    } catch (err) { console.error('Failed to fetch questions:', err) }
  }

  const handleCreateSession = async () => {
    if (!selectedQuestion) { setError('Please select a topic and question first'); return }
    setCreating(true); setError('')
    try {
      const { data } = await api.post('/sessions', { questionId: selectedQuestion })
      router.push(`/pair/${data.id}`)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create session')
    } finally { setCreating(false) }
  }

  const handleJoinSession = async () => {
    if (!joinCode.trim()) { setError('Please enter a join code'); return }
    setJoining(true); setError('')
    try {
      const { data } = await api.post('/sessions/join', { joinCode: joinCode.trim().toUpperCase() })
      router.push(`/pair/${data.id}`)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to join session')
    } finally { setJoining(false) }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    router.push('/login')
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getDuration = (start: string, end?: string) => {
    const s = new Date(start).getTime()
    const e = end ? new Date(end).getTime() : Date.now()
    const mins = Math.round((e - s) / 60000)
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const getPartnerName = (session: any) => {
    if (!session.members || !user) return 'No partner'
    const partner = session.members.find((m: any) => m.userId !== user.id)
    return partner?.user ? `${partner.user.firstName} ${partner.user.lastName}` : 'Waiting...'
  }

  // Stats for the header
  const completedCount = sessions.filter((s: any) => s.status === 'COMPLETED').length
  const totalInterventions = sessions.reduce((sum: number, s: any) => sum + (s.interventions?.length || 0), 0)

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Navbar */}
      <nav className="bg-surface-900/80 backdrop-blur-md border-b border-surface-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <h1 className="text-xl font-bold text-white">PairPath</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-surface-300">
                Welcome, <span className="text-primary-400 font-medium">{user?.firstName || 'Loading...'}</span>
              </span>
              <button onClick={handleLogout}
                className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm transition-colors border border-surface-600">
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Hero Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-gradient-to-br from-primary-600/15 to-transparent border border-primary-500/10 rounded-2xl p-5">
            <p className="text-xs text-primary-300 font-medium uppercase tracking-wider mb-1">Total Sessions</p>
            <p className="text-3xl font-bold text-white">{sessions.length}</p>
          </div>
          <div className="bg-gradient-to-br from-accent-600/15 to-transparent border border-accent-500/10 rounded-2xl p-5">
            <p className="text-xs text-accent-300 font-medium uppercase tracking-wider mb-1">Completed</p>
            <p className="text-3xl font-bold text-white">{completedCount}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm animate-fade-in">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Create Session */}
          <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6 hover:border-surface-600 transition-colors">
            <div className="flex items-center mb-5">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center mr-3 shadow-lg shadow-primary-600/10">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Create Session</h3>
                <p className="text-sm text-surface-400">Start a new pair programming session</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="topic-select" className="block text-sm font-medium text-surface-300 mb-1.5">Select Topic</label>
                <select id="topic-select" value={selectedTopic} onChange={(e) => handleTopicChange(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all">
                  <option value="">Choose a topic...</option>
                  {topics.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
              </div>

              {questions.length > 0 && (
                <div className="animate-fade-in">
                  <label htmlFor="question-select" className="block text-sm font-medium text-surface-300 mb-1.5">Select Question</label>
                  <select id="question-select" value={selectedQuestion} onChange={(e) => setSelectedQuestion(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all">
                    <option value="">Choose a question...</option>
                    {questions.map((q) => (
                      <option key={q.id} value={q.id}>{q.title} ({q.difficulty})</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedQuestion && (
                <div className="animate-fade-in bg-surface-800 rounded-lg p-4 border border-surface-600">
                  <p className="text-sm text-surface-300">{questions.find(q => q.id === selectedQuestion)?.description}</p>
                </div>
              )}

              <button onClick={handleCreateSession} disabled={creating || !selectedQuestion}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-600/10">
                {creating ? 'Creating...' : 'Create New Session'}
              </button>
            </div>
          </div>

          {/* Join Session */}
          <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6 hover:border-surface-600 transition-colors">
            <div className="flex items-center mb-5">
              <div className="w-10 h-10 bg-gradient-to-br from-accent-500 to-accent-700 rounded-xl flex items-center justify-center mr-3 shadow-lg shadow-accent-600/10">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Join Session</h3>
                <p className="text-sm text-surface-400">Enter a 6-digit code to join</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="join-code-input" className="block text-sm font-medium text-surface-300 mb-1.5">Join Code</label>
                <input id="join-code-input" type="text" placeholder="e.g. ABC123" value={joinCode} maxLength={6}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJoinSession() }}
                  className="w-full px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-white text-center text-2xl tracking-[0.3em] font-mono placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all uppercase" />
              </div>
              <button onClick={handleJoinSession} disabled={joining || !joinCode.trim()}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-500 hover:to-accent-600 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent-600/10">
                {joining ? 'Joining...' : 'Join Session'}
              </button>
            </div>
          </div>
        </div>

        {/* Session History */}
        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center mr-3 shadow-lg shadow-emerald-600/10">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Session History</h3>
                <p className="text-sm text-surface-400">Click any session to view full details</p>
              </div>
            </div>
          </div>

          {loadingSessions ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-surface-400 text-sm">Loading sessions...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <p className="text-surface-300 font-medium mb-1">No sessions yet</p>
              <p className="text-surface-500 text-sm">Create or join a session above to get started!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session: any) => (
                <div
                  key={session.id}
                  onClick={() => router.push(`/session-history/${session.id}`)}
                  className="flex items-center justify-between bg-surface-800/50 border border-surface-700/50 rounded-xl p-4 hover:bg-surface-800 hover:border-surface-600 transition-all cursor-pointer group"
                >
                  <div className="flex items-center space-x-4 min-w-0">
                    {/* Question initial badge */}
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-600/20 to-primary-800/10 border border-primary-500/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary-400">
                        {(session.question?.title || 'U')[0].toUpperCase()}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-white truncate group-hover:text-primary-300 transition-colors">
                        {session.question?.title || 'Untitled'}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-surface-400">
                          {formatDate(session.startedAt)} at {formatTime(session.startedAt)}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-surface-600" />
                        <span className="text-xs text-surface-400">
                          with <span className="text-surface-300">{getPartnerName(session)}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    {/* Intervention count */}
                    {session.interventions && session.interventions.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/15">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        {session.interventions.length}
                      </span>
                    )}

                    {/* Duration */}
                    <span className="text-xs text-surface-500 tabular-nums">
                      {getDuration(session.startedAt, session.endedAt)}
                    </span>

                    {/* Arrow */}
                    <svg className="w-4 h-4 text-surface-600 group-hover:text-primary-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
