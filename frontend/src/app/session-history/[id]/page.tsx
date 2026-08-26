'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import api from '@/lib/api'
import type { User } from '@/types'

interface SessionDetail {
  id: string
  joinCode: string
  status: string
  startedAt: string
  endedAt?: string
  finalCode?: string
  question?: {
    title: string
    description: string
    difficulty: string
    conceptTags: string[]
  }
  members?: {
    userId: string
    role: string
    user?: { firstName: string; lastName: string; email: string }
  }[]
  events?: {
    id: string
    userId: string
    eventType: string
    timestamp: string
    metadata: string
  }[]
  interventions?: {
    id: string
    state: string
    action: string
    message: string
    shownAt: string
    accepted?: boolean
  }[]
}

export default function SessionHistoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'timeline' | 'chat' | 'code' | 'interventions'>('timeline')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) setUser(JSON.parse(userData))
    fetchSession()
  }, [sessionId])

  const fetchSession = async () => {
    try {
      const { data } = await api.get(`/sessions/analytics/${sessionId}`)
      setSession(data)
    } catch (err) {
      console.error('Failed to fetch session:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDuration = (start: string, end?: string) => {
    const s = new Date(start).getTime()
    const e = end ? new Date(end).getTime() : Date.now()
    const mins = Math.round((e - s) / 60000)
    if (mins < 60) return `${mins} minutes`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const getUserName = (userId: string) => {
    const member = session?.members?.find(m => m.userId === userId)
    return member?.user ? `${member.user.firstName} ${member.user.lastName}` : 'Unknown'
  }

  const getPartnerName = () => {
    if (!session?.members || !user) return 'No partner'
    const partner = session.members.find(m => m.userId !== user.id)
    return partner?.user ? `${partner.user.firstName} ${partner.user.lastName}` : 'No partner'
  }

  const parseMetadata = (metadata: string) => {
    try { return typeof metadata === 'string' ? JSON.parse(metadata) : metadata } catch { return {} }
  }

  // Filter events by type
  const chatMessages = session?.events?.filter(e => e.eventType === 'DISCUSSION_NOTE') || []
  const codeEvents = session?.events?.filter(e => ['CODE_EDIT', 'CODE_RUN', 'CODE_RUN_RESULT'].includes(e.eventType)) || []
  const allEvents = session?.events || []
  const interventions = session?.interventions || []

  const stateColors: Record<string, string> = {
    PRODUCTIVE: 'text-green-400 bg-green-500/10 border-green-500/20',
    DRIVER_DOMINANCE: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    PASSIVE_NAVIGATOR: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    LOGIC_STRUGGLE: 'text-red-400 bg-red-500/10 border-red-500/20',
    DISENGAGED: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
    LOW_QUALITY_REVIEW: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  }

  const eventIcons: Record<string, string> = {
    JOIN: '👋',
    CODE_EDIT: '✏️',
    CODE_RUN: '▶️',
    CODE_RUN_RESULT: '📊',
    DISCUSSION_NOTE: '💬',
    ROLE_SWITCH: '🔄',
    INTERVENTION_RESPONSE: '🤖',
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-surface-400 text-sm">Loading session details...</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-surface-400 mb-4">Session not found</p>
          <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-primary-600 text-white rounded-lg">
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const tabs = [
    { key: 'timeline' as const, label: 'Timeline', count: allEvents.length },
    { key: 'chat' as const, label: 'Chat History', count: chatMessages.length },
    { key: 'code' as const, label: 'Code Activity', count: codeEvents.length },
    { key: 'interventions' as const, label: 'ML Interventions', count: interventions.length },
  ]

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <nav className="bg-surface-900/80 backdrop-blur-md border-b border-surface-700 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/dashboard')} className="p-2 hover:bg-surface-800 rounded-lg transition-colors group">
                <svg className="w-5 h-5 text-surface-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <h1 className="text-lg font-semibold text-white">{session.question?.title || 'Session Details'}</h1>
                <p className="text-xs text-surface-400">{formatDate(session.startedAt)}</p>
              </div>
            </div>
            <span className="text-xs font-mono text-surface-500 bg-surface-800 px-3 py-1 rounded-full border border-surface-700">
              {session.joinCode}
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Session Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-primary-600/10 to-primary-800/5 border border-primary-500/15 rounded-xl p-4">
            <p className="text-xs text-primary-300 font-medium mb-1">Duration</p>
            <p className="text-lg font-bold text-white">{getDuration(session.startedAt, session.endedAt)}</p>
          </div>
          <div className="bg-gradient-to-br from-accent-600/10 to-accent-800/5 border border-accent-500/15 rounded-xl p-4">
            <p className="text-xs text-accent-300 font-medium mb-1">Partner</p>
            <p className="text-lg font-bold text-white truncate">{getPartnerName()}</p>
          </div>
          <div className="bg-gradient-to-br from-amber-600/10 to-amber-800/5 border border-amber-500/15 rounded-xl p-4">
            <p className="text-xs text-amber-300 font-medium mb-1">Interventions</p>
            <p className="text-lg font-bold text-white">{interventions.length}</p>
          </div>
          <div className="bg-gradient-to-br from-cyan-600/10 to-cyan-800/5 border border-cyan-500/15 rounded-xl p-4">
            <p className="text-xs text-cyan-300 font-medium mb-1">Messages</p>
            <p className="text-lg font-bold text-white">{chatMessages.length}</p>
          </div>
        </div>

        {/* Question Info */}
        {session.question && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 mb-6">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold text-white">{session.question.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                session.question.difficulty === 'EASY' ? 'bg-green-500/15 text-green-400' :
                session.question.difficulty === 'MEDIUM' ? 'bg-amber-500/15 text-amber-400' :
                'bg-red-500/15 text-red-400'
              }`}>{session.question.difficulty}</span>
            </div>
            <p className="text-sm text-surface-400 mb-3">{session.question.description}</p>
            {session.question.conceptTags && (
              <div className="flex flex-wrap gap-1.5">
                {(session.question.conceptTags as string[]).map((tag, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-surface-800 text-surface-300 rounded-full border border-surface-600">{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 bg-surface-900 p-1 rounded-xl border border-surface-700 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                  : 'text-surface-400 hover:text-white hover:bg-surface-800'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-primary-500/30' : 'bg-surface-700'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="max-h-[600px] overflow-y-auto p-4">
              {allEvents.length === 0 ? (
                <p className="text-center text-surface-400 py-12">No events recorded</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-px bg-surface-700" />
                  <div className="space-y-1">
                    {allEvents.map((event, i) => (
                      <div key={event.id} className="relative pl-12 py-2 group">
                        <div className="absolute left-3 top-3 w-4 h-4 rounded-full bg-surface-800 border-2 border-surface-600 group-hover:border-primary-500 transition-colors flex items-center justify-center text-[8px]">
                          {eventIcons[event.eventType] || '•'}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-surface-500 tabular-nums w-20 flex-shrink-0">{formatTime(event.timestamp)}</span>
                          <span className="text-xs font-mono text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded">{event.eventType}</span>
                          <span className="text-xs text-surface-400">{getUserName(event.userId)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chat History Tab */}
          {activeTab === 'chat' && (
            <div className="max-h-[600px] overflow-y-auto p-4">
              {chatMessages.length === 0 ? (
                <p className="text-center text-surface-400 py-12">No chat messages in this session</p>
              ) : (
                <div className="space-y-3">
                  {chatMessages.map(msg => {
                    const meta = parseMetadata(msg.metadata)
                    const isMe = msg.userId === user?.id
                    return (
                      <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                          isMe
                            ? 'bg-primary-600/20 border border-primary-500/20 rounded-br-md'
                            : 'bg-surface-800 border border-surface-700 rounded-bl-md'
                        }`}>
                          <p className={`text-xs font-medium mb-1 ${isMe ? 'text-primary-300' : 'text-accent-300'}`}>
                            {getUserName(msg.userId)}
                          </p>
                          <p className="text-sm text-white">{meta.note || '—'}</p>
                          <p className="text-[10px] text-surface-500 mt-1 text-right">{formatTime(msg.timestamp)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Code Activity Tab */}
          {activeTab === 'code' && (
            <div className="max-h-[600px] overflow-y-auto">
              {codeEvents.length === 0 ? (
                <p className="text-center text-surface-400 py-12">No code activity recorded</p>
              ) : (
                <div className="divide-y divide-surface-700">
                  {codeEvents.map(event => {
                    const meta = parseMetadata(event.metadata)
                    const isRun = event.eventType === 'CODE_RUN'
                    const isResult = event.eventType === 'CODE_RUN_RESULT'
                    return (
                      <div key={event.id} className="px-4 py-3 hover:bg-surface-800/50 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                              isRun ? 'bg-blue-500/10 text-blue-400' :
                              isResult ? (meta.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400') :
                              'bg-surface-700 text-surface-300'
                            }`}>
                              {event.eventType}
                            </span>
                            <span className="text-xs text-surface-400">{getUserName(event.userId)}</span>
                          </div>
                          <span className="text-xs text-surface-500 tabular-nums">{formatTime(event.timestamp)}</span>
                        </div>
                        {isResult && (
                          <p className={`text-xs mt-1 ${meta.success ? 'text-green-400' : 'text-red-400'}`}>
                            {meta.success ? 'Compiled and ran successfully' : 'Compilation or runtime error'}
                          </p>
                        )}
                        {meta.codeLength && (
                          <p className="text-xs text-surface-500 mt-1">{meta.codeLength} characters</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Final Code */}
              {session.finalCode && (
                <div className="border-t border-surface-700 p-4">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-accent-400 rounded-full" />
                    Final Submitted Code
                  </h4>
                  <pre className="bg-surface-950 border border-surface-700 rounded-lg p-4 text-xs text-surface-200 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {session.finalCode}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Interventions Tab */}
          {activeTab === 'interventions' && (
            <div className="max-h-[600px] overflow-y-auto p-4">
              {interventions.length === 0 ? (
                <p className="text-center text-surface-400 py-12">No ML interventions were triggered</p>
              ) : (
                <div className="space-y-3">
                  {interventions.map(intv => (
                    <div key={intv.id} className={`border rounded-xl p-4 ${stateColors[intv.state] || 'border-surface-700'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">{intv.state.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-surface-500 tabular-nums">{formatTime(intv.shownAt)}</span>
                      </div>
                      <p className="text-sm text-surface-300 mb-2">{intv.message}</p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono bg-surface-800 text-surface-400 px-2 py-0.5 rounded">{intv.action}</span>
                        {intv.accepted !== null && intv.accepted !== undefined && (
                          <span className={`text-xs font-medium ${intv.accepted ? 'text-green-400' : 'text-red-400'}`}>
                            {intv.accepted ? 'Accepted' : 'Dismissed'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
