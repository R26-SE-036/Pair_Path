// API and shared types for PairPath

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
}

export interface AuthResponse {
  user: User
  accessToken: string
  refreshToken: string
}

export interface Topic {
  id: string
  name: string
  description: string
  questions?: Question[]
}

export interface Question {
  id: string
  topicId: string
  title: string
  description: string
  difficulty: string
  starterCode: string
  referenceSolution: string
  reviewQuestions: string[]
  conceptTags: string[]
  topic?: Topic
}

export interface PairSession {
  id: string
  joinCode: string
  questionId: string
  status: 'ACTIVE' | 'COMPLETED'
  startedAt: string
  endedAt?: string
  finalCode?: string
  question?: Question
  members?: PairSessionMember[]
}

export interface PairSessionMember {
  id: string
  sessionId: string
  userId: string
  role: 'DRIVER' | 'NAVIGATOR'
  joinedAt: string
  user?: User
}

export interface SessionEvent {
  id: string
  sessionId: string
  userId: string
  role: string
  eventType: string
  timestamp: string
  metadata: Record<string, any>
}

export interface CodeRunResult {
  success: boolean
  stdout: string
  stderr: string
  compileError: string | null
}

export interface InterventionAction {
  id?: string
  state: string
  action: string
  delivery: {
    type: string
    uiTarget: string
    uiEffect: 'glow' | 'pulse' | 'highlight' | 'toast' | 'none'
    message: string
    /** Present on self-dismissing deliveries (e.g. encouragement toasts). */
    autoDismissMs?: number
  }
}

export interface RAGHint {
  conceptReminder: string
  exampleIdea: string
  reflectiveQuestion: string
}

export interface ReviewSubmission {
  id: string
  sessionId: string
  userId: string
  answers: boolean[]
  score: number
  completedAt: string
  user?: User
}

export interface ReviewResult {
  sessionId: string
  reviews: {
    userId: string
    firstName: string
    lastName: string
    score: number
  }[]
  averageScore: number
  recommendations: string[]
}

export interface ChatMessage {
  note: string
  userId: string
  userName?: string
  timestamp: string
}

export type PairState =
  | 'PRODUCTIVE'
  | 'DRIVER_DOMINANCE'
  | 'PASSIVE_NAVIGATOR'
  | 'LOGIC_STRUGGLE'
  | 'DISENGAGED'
