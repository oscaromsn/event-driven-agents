// ============================================================================
// Event Types
// ============================================================================

export type BamlUsage = {
  totalTokens: number
}

export type LLMMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type Event =
  | { type: 'user_message'; content: string; timestamp: number }
  | { type: 'execution_approved'; commandId: string }
  | { type: 'execution_rejected'; commandId: string; reason: string }
  | { type: 'interrupt_requested'; reason: string }
  | { type: 'llm_response_started'; streamId: string }
  | { type: 'llm_text_chunk'; streamId: string; text: string }
  | { type: 'llm_thinking'; content: string }
  | { type: 'llm_parse_error'; error: { message: string; raw?: string } }
  | { type: 'llm_response_completed'; streamId: string; usage: BamlUsage }
  | { type: 'llm_stream_interrupted'; streamId: string }
  | { type: 'command_requested'; commandId: string; command: 'eval'; params: { code: string; description?: string } }
  | { type: 'command_started'; commandId: string }
  | { type: 'command_completed'; commandId: string; result: string }
  | { type: 'command_failed'; commandId: string; error: string }
  | { type: 'interrupt_cleanup_completed' }

// Domain types
import type { AntmlFunctionCall, AntmlFunctionResult } from './antml/format.ts'

export type Message =
  | {
      id: string
      role: 'user' | 'assistant'
      type: 'text'
      content: string
      timestamp: number
    }
  | {
      id: string
      role: 'assistant'
      type: 'function_calls'
      calls: AntmlFunctionCall[]
      timestamp: number
    }
  | {
      id: string
      role: 'user'
      type: 'function_results'
      results: AntmlFunctionResult[]
      timestamp: number
    }

export type Command = {
  commandId: string
  command: 'eval'
  params: { code: string; description?: string }
  status: 'requested' | 'approved' | 'started' | 'completed' | 'failed' | 'rejected'
  result?: string
  error?: string
  resultSentToLLM?: boolean // Track if tool result was already added to LLM messages
}

// Helper
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}
