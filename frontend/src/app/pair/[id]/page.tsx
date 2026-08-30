'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { io, Socket } from 'socket.io-client'
import Editor from '@monaco-editor/react'
import api from '@/lib/api'
import type { PairSession, User, ChatMessage, InterventionAction, RAGHint, CodeRunResult } from '@/types'

export default function PairRoomPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  // State
  const [socket, setSocket] = useState<Socket | null>(null)
  const [session, setSession] = useState<PairSession | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [code, setCode] = useState('')
  const [role, setRole] = useState<'DRIVER' | 'NAVIGATOR'>('DRIVER')
  const [partnerConnected, setPartnerConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [intervention, setIntervention] = useState<InterventionAction | null>(null)
  const [praise, setPraise] = useState<InterventionAction | null>(null)
  const [ragHint, setRagHint] = useState<RAGHint | null>(null)
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [ending, setEnding] = useState(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const praiseTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Load user and session
  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (!token) { router.push('/login'); return }
    if (userData) setUser(JSON.parse(userData))
    fetchSession()
  }, [sessionId, router])

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // Socket connection
  useEffect(() => {
    if (!user) return
    const token = localStorage.getItem('token')
    const newSocket = io('http://localhost:3001', { auth: { token } })

    newSocket.on('connect', () => {
      setIsConnected(true)
      newSocket.emit('join_room', { sessionId, userId: user.id })
    })

    newSocket.on('room_state', (data: any) => {
      if (data.members?.length > 1) setPartnerConnected(true)
    })

    newSocket.on('code_update', (data: { code: string }) => {
      setCode(data.code)
    })

    newSocket.on('role_switch', (data: any) => {
      if (data.roles?.[user.id]) setRole(data.roles[user.id])
    })

    newSocket.on('discussion_note', (data: ChatMessage) => {
      setMessages(prev => [...prev, data])
    })

    newSocket.on('code_result', (data: CodeRunResult) => {
      setIsRunning(false)
      if (data.success) {
        setOutput(data.stdout || 'Program executed successfully (no output)')
      } else {
        setOutput(data.compileError || data.stderr || 'Execution failed')
      }
    })

    newSocket.on('intervention', (data: InterventionAction) => {
      // Encouragement is a self-dismissing toast, not a card the pair has to
      // act on — it should never interrupt their flow or await a response.
      if (data.action === 'POSITIVE_REINFORCEMENT') {
        setPraise(data)
        if (praiseTimerRef.current) clearTimeout(praiseTimerRef.current)
        praiseTimerRef.current = setTimeout(
          () => setPraise(null),
          data.delivery?.autoDismissMs ?? 4000,
        )
        return
      }
      setIntervention(data)
    })

    newSocket.on('rag_hint', (data: RAGHint) => {
      setRagHint(data)
    })

    newSocket.on('session_ended', () => {
      router.push(`/review/${sessionId}`)
    })

    newSocket.on('user_joined', () => setPartnerConnected(true))
    newSocket.on('user_left', () => setPartnerConnected(false))
    newSocket.on('disconnect', () => setIsConnected(false))

    setSocket(newSocket)
    return () => {
      newSocket.disconnect()
      if (praiseTimerRef.current) clearTimeout(praiseTimerRef.current)
    }
  }, [user, sessionId, router])

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchSession = async () => {
    try {
      const { data } = await api.get(`/sessions/${sessionId}`)
      setSession(data)
      if (data.finalCode) setCode(data.finalCode)
      else if (data.question?.starterCode) setCode(data.question.starterCode)
      // Determine role
      const userData = localStorage.getItem('user')
      if (userData) {
        const u = JSON.parse(userData)
        const member = data.members?.find((m: any) => m.userId === u.id)
        if (member) setRole(member.role)
      }
    } catch (err) { console.error('Failed to fetch session:', err) }
  }

  const handleCodeChange = (value: string | undefined) => {
    if (!value || role !== 'DRIVER') return
    setCode(value)
    socket?.emit('code_change', { sessionId, code: value, userId: user?.id })
  }

  const handleRoleSwitch = () => {
    socket?.emit('role_switch', { sessionId, userId: user?.id })
  }

  const handleRunCode = async () => {
    setIsRunning(true)
    setOutput('Compiling and running...')
    socket?.emit('run_code', { sessionId, code, userId: user?.id })
  }

  const handleSendMessage = () => {
    if (!chatInput.trim()) return
    const msg: ChatMessage = {
      note: chatInput,
      userId: user?.id || '',
      userName: user?.firstName || 'You',
      timestamp: new Date().toISOString()
    }
    socket?.emit('discussion_note', { sessionId, ...msg })
    setMessages(prev => [...prev, msg])
    setChatInput('')
  }

  const handleInterventionResponse = (accepted: boolean) => {
    socket?.emit('intervention_response', { sessionId, interventionId: intervention?.id, accepted })
    setIntervention(null)
  }

  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this session? Both students will be redirected to the review.')) return
    setEnding(true)
    try {
      await api.post(`/sessions/${sessionId}/end`, { finalCode: code })
      socket?.emit('end_session', { sessionId })
      router.push(`/review/${sessionId}`)
    } catch (err) {
      console.error('Failed to end session:', err)
      setEnding(false)
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  const getInterventionIcon = (action: string) => {
    switch (action) {
      case 'ROLE_SWITCH_SUPPORT': return '🔄'
      case 'NAVIGATOR_PARTICIPATION_SUPPORT': return '💬'
      case 'LOGIC_SUPPORT': return '🧠'
      case 'RE_ENGAGEMENT_SUPPORT': return '⚡'
      default: return '💡'
    }
  }

  return (
    <div className="h-screen flex flex-col bg-surface-950">
      {/* Encouragement toast — self-dismissing, no action required */}
      {praise && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up pointer-events-none"
        >
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full border border-emerald-500/40 bg-emerald-950/90 shadow-lg shadow-emerald-900/30 backdrop-blur-sm">
            <span className="text-base leading-none" aria-hidden="true">✨</span>
            <span className="text-sm font-medium text-emerald-200 whitespace-nowrap">
              {praise.delivery?.message}
            </span>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <nav className="bg-surface-900 border-b border-surface-700 flex-shrink-0">
        <div className="px-4 flex justify-between h-12 items-center">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard" className="text-surface-400 hover:text-surface-200 text-sm transition-colors">← Dashboard</Link>
            <span className="text-surface-500">|</span>
            <span className="text-xs text-surface-400 font-mono bg-surface-800 px-2 py-1 rounded">
              Code: <span className="text-primary-400 font-bold">{session?.joinCode || '...'}</span>
            </span>
            {/* Role Badge */}
            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
              role === 'DRIVER' ? 'bg-primary-600/20 text-primary-300 border border-primary-500/30'
                                : 'bg-accent-600/20 text-accent-300 border border-accent-500/30'
            }`}>
              {role === 'DRIVER' ? '🚗 DRIVER' : '🧭 NAVIGATOR'}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-xs text-surface-400 font-mono">{formatTime(elapsedTime)}</span>
            <span className={`text-xs flex items-center ${isConnected ? 'text-accent-400' : 'text-red-400'}`}>
              <span className="w-2 h-2 rounded-full mr-1.5 inline-block" style={{backgroundColor: isConnected ? 'var(--cg-ok)' : 'var(--cg-danger)'}}></span>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span className={`text-xs ${partnerConnected ? 'text-accent-400' : 'text-surface-500'}`}>
              Partner: {partnerConnected ? '✓ Online' : '✗ Waiting'}
            </span>
            <button onClick={handleEndSession} disabled={ending}
              className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-all disabled:opacity-50">
              {ending ? 'Ending...' : 'End Session'}
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Question + Editor + Output */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Question Panel */}
          {session?.question && (
            <div className="bg-surface-900 border-b border-surface-700 px-4 py-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-surface-200">{session.question.title}</h3>
                  <p className="text-xs text-surface-400 mt-0.5">{session.question.description}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs bg-primary-600/20 text-primary-300 px-2 py-0.5 rounded">{session.question.difficulty}</span>
                  {(session.question.conceptTags as string[])?.map((tag: string, i: number) => (
                    <span key={i} className="text-xs bg-surface-800 text-surface-400 px-2 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Code Editor */}
          <div className="flex-1 relative">
            <div className="absolute top-2 right-2 z-10 flex items-center space-x-2">
              <button onClick={handleRoleSwitch} id="role-switch-button"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  intervention?.delivery?.uiTarget === 'role_switch_button' && intervention?.delivery?.uiEffect === 'glow'
                    ? 'animate-glow bg-primary-600 text-white' : 'bg-surface-800 text-surface-300 hover:bg-surface-700 border border-surface-600'
                }`}>
                🔄 Switch Role
              </button>
              <button onClick={handleRunCode} disabled={isRunning}
                className="px-4 py-1.5 bg-accent-600 hover:bg-accent-700 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50">
                {isRunning ? '⟳ Running...' : '▶ Run Code'}
              </button>
            </div>
            <Editor
              height="100%"
              defaultLanguage="java"
              theme="vs"
              value={code}
              onChange={handleCodeChange}
              options={{
                readOnly: role !== 'DRIVER',
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 12 },
                wordWrap: 'on',
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                automaticLayout: true,
              }}
            />
          </div>

          {/* Output Panel */}
          <div className="bg-surface-900 border-t border-surface-700 flex-shrink-0" style={{ height: '160px' }}>
            <div className="px-4 py-2 border-b border-surface-700 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Output</h4>
              <button onClick={() => setOutput('')} className="text-xs text-surface-500 hover:text-surface-300 transition-colors">Clear</button>
            </div>
            <pre className="p-4 text-sm font-mono text-surface-200 overflow-auto h-[120px] whitespace-pre-wrap">
              {output || 'Click "Run Code" to see output here...'}
            </pre>
          </div>
        </div>

        {/* Right Sidebar: Chat + Interventions + Hints */}
        <div className="w-80 flex-shrink-0 border-l border-surface-700 flex flex-col bg-surface-900">
          {/* Chat Panel */}
          <div className={`flex-1 flex flex-col min-h-0 ${
            intervention?.delivery?.uiTarget === 'discussion_panel' && intervention?.delivery?.uiEffect === 'glow'
              ? 'animate-glow' : ''
          }`}>
            <div className="px-4 py-2.5 border-b border-surface-700">
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Discussion</h4>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.map((msg, i) => (
                <div key={i} className={`text-xs rounded-lg p-2 animate-fade-in ${
                  msg.userId === user?.id ? 'bg-primary-600/20 text-primary-200 ml-4' : 'bg-surface-800 text-surface-300 mr-4'
                }`}>
                  <span className="font-semibold">{msg.userId === user?.id ? 'You' : msg.userName || 'Partner'}</span>
                  <p className="mt-0.5">{msg.note}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className={`p-3 border-t border-surface-700 ${
              intervention?.delivery?.uiTarget === 'chat_input' && intervention?.delivery?.uiEffect === 'pulse'
                ? 'animate-pulse-soft' : ''
            }`}>
              <div className="flex space-x-2">
                <input id="chat-input" type="text" value={chatInput} placeholder="Type a message..."
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage() }}
                  className="flex-1 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                <button onClick={handleSendMessage}
                  className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors">
                  Send
                </button>
              </div>
            </div>
          </div>

          {/* Intervention Card */}
          {intervention && intervention.action !== 'NO_ACTION' && (
            <div className={`mx-3 mb-3 p-4 rounded-xl border-2 animate-slide-up ${
              intervention.delivery?.uiEffect === 'glow' ? 'border-primary-500/50 bg-primary-600/10' :
              intervention.delivery?.uiEffect === 'pulse' ? 'border-accent-500/50 bg-accent-600/10 animate-pulse-soft' :
              intervention.delivery?.uiEffect === 'highlight' ? 'border-yellow-500/50 bg-yellow-600/10 animate-highlight' :
              'border-surface-600 bg-surface-800'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-surface-200">
                  {getInterventionIcon(intervention.action)} Suggestion
                </span>
                <button onClick={() => setIntervention(null)} className="text-surface-400 hover:text-surface-200 text-xs">✕</button>
              </div>
              <p className="text-xs text-surface-300 mb-3">{intervention.delivery?.message}</p>
              <div className="flex space-x-2">
                <button onClick={() => handleInterventionResponse(true)}
                  className="flex-1 py-1.5 bg-accent-600/30 hover:bg-accent-600/50 text-accent-300 rounded-lg text-xs font-medium transition-all">
                  Accept
                </button>
                <button onClick={() => handleInterventionResponse(false)}
                  className="flex-1 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded-lg text-xs font-medium transition-all">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* RAG Hint Card */}
          {ragHint && (
            <div id="hint-panel" className={`mx-3 mb-3 p-4 rounded-xl border animate-slide-up ${
              intervention?.delivery?.uiTarget === 'hint_panel' && intervention?.delivery?.uiEffect === 'highlight'
                ? 'border-yellow-500/50 bg-yellow-600/10 animate-highlight' : 'border-surface-600 bg-surface-800'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-surface-200">🧠 Hint</span>
                <button onClick={() => setRagHint(null)} className="text-surface-400 hover:text-surface-200 text-xs">✕</button>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-primary-400 font-medium">Concept:</span>
                  <p className="text-surface-300 mt-0.5">{ragHint.conceptReminder}</p>
                </div>
                <div>
                  <span className="text-accent-400 font-medium">Example:</span>
                  <p className="text-surface-300 mt-0.5">{ragHint.exampleIdea}</p>
                </div>
                <div>
                  <span className="text-yellow-400 font-medium">Think about:</span>
                  <p className="text-surface-300 mt-0.5">{ragHint.reflectiveQuestion}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
