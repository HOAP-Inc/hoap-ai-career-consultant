// 型定義
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface StatusMeta {
  [key: string]: unknown
  ai_analysis?: string
  being_text?: string
  can_text?: string
  can_texts?: string[]
  doing_text?: string
  must_have_ids?: number[]
  must_text?: string
  ng_ids?: number[]
  pending_ids?: number[]
  qual_ids?: number[]
  role_ids?: number[]
  self_text?: string
  status_bar?: string
  strength_text?: string
  will_text?: string
  will_texts?: string[]
}

export interface SessionStatus {
  drill: string | null
  licenses: string[]
  meta: Record<string, unknown>
  qual_ids: number[]
  stage: string
  status: "phase" | "awaitingChoice"
  step: Step
}

export interface ChatMessage {
  content: string
  role: "user" | "assistant" | "system"
  step?: number
  text?: string
}

export interface SessionData {
  drill: {
    awaitingChoice: boolean
    options: string[]
    phase: string | null
  }
  history: ChatMessage[]
  id: string
  meta: {
    deepening_attempt_total: number
    [key: string]: unknown
  }
  stage: {
    turnIndex: number
  }
  status: SessionStatus
  step: Step
}

export interface Qualification {
  category: string
  id: number
  name: string
}

export interface Tag {
  category: string
  id: number
  name: string
}

export interface LLMResponse {
  _raw?: string
  error: string | null
  ok: boolean
  parsed?: unknown
}
