// ============================================================================
// Messages State Reducer
// ============================================================================

import type { Message } from '../events.ts'
import { generateId } from '../events.ts'
import { defineReducer } from './types.ts'

export type MessagesStateType = {
  messages: Message[]
  maxMessages: number
  streamingMessageIndex: number | null
  queuedUserMessages: Array<{ id: string; content: string; timestamp: number }>
  tokenEstimate: number
  isStreaming: boolean
}

// Simple token estimation
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Helper to estimate tokens for a message
function estimateMessageTokens(msg: Message): number {
  switch (msg.type) {
    case 'text':
      return estimateTokens(msg.content)
    case 'function_calls':
      return msg.calls.reduce((sum, call) => {
        const paramsText = call.parameters.map(p => p.value).join('')
        return sum + estimateTokens(call.name) + estimateTokens(paramsText)
      }, 0)
    case 'function_results':
      return msg.results.reduce((sum, result) => {
        const text = result.success ? result.output : result.error
        return sum + estimateTokens(text)
      }, 0)
  }
}

// Helper to recalculate token estimate
function withTokenEstimate(state: MessagesStateType): MessagesStateType {
  return {
    ...state,
    tokenEstimate: state.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
  }
}

// Helper to add a message and trim to max
function addMessage(state: MessagesStateType, message: Message): MessagesStateType {
  const newMessages = [...state.messages, message]
  const trimmed = newMessages.slice(-state.maxMessages)
  return withTokenEstimate({ ...state, messages: trimmed })
}

export const messagesReducer = defineReducer<MessagesStateType>()({
  initialState: {
    messages: [],
    maxMessages: 100,
    streamingMessageIndex: null,
    queuedUserMessages: [],
    tokenEstimate: 0,
    isStreaming: false
  },

  eventTypes: [
    'user_message',
    'llm_response_started',
    'llm_text_chunk',
    'llm_response_completed',
    'llm_stream_interrupted',
    'command_completed',
    'command_failed',
    'execution_rejected',
    'interrupt_requested'
  ] as const,

  reduce: (state, event) => {
  switch (event.type) {
    case 'user_message': {
      console.log('[MessagesState] Processing user_message')

      if (state.isStreaming || state.streamingMessageIndex !== null) {
        // QUEUE THE MESSAGE - don't add to main messages yet
        console.log('[MessagesState] Queuing message (streaming in progress)')
        return {
          ...state,
          queuedUserMessages: [
            ...state.queuedUserMessages,
            {
              id: generateId(),
              content: event.content,
              timestamp: event.timestamp
            }
          ]
        }
      } else {
        // Add to messages normally
        console.log('[MessagesState] Adding message to history')
        return addMessage(state, {
          id: generateId(),
          role: 'user',
          type: 'text',
          content: event.content,
          timestamp: event.timestamp
        })
      }
    }

    case 'llm_response_started': {
      const newMessage: Message = {
        id: event.streamId,
        role: 'assistant',
        type: 'text',
        content: '',
        timestamp: Date.now()
      }
      const newMessages = [...state.messages, newMessage]
      return {
        ...state,
        messages: newMessages,
        streamingMessageIndex: newMessages.length - 1,
        isStreaming: true
      }
    }

    case 'llm_text_chunk': {
      const idx = state.streamingMessageIndex
      if (idx !== null && idx < state.messages.length) {
        const message = state.messages[idx]
        if (message && message.id === event.streamId && message.type === 'text') {
          const messages = [...state.messages]
          messages[idx] = { ...message, content: message.content + event.text }
          return withTokenEstimate({ ...state, messages })
        }
      }
      return state
    }

    case 'llm_stream_interrupted': {
      return {
        ...state,
        streamingMessageIndex: null,
        isStreaming: false
      }
    }

    case 'llm_response_completed': {
      console.log('[MessagesState] Processing llm_response_completed')

      // Flush queued messages to main messages
      const queuedAsMessages: Message[] = state.queuedUserMessages.map(q => ({
        id: q.id,
        role: 'user' as const,
        type: 'text' as const,
        content: q.content,
        timestamp: q.timestamp
      }))

      const updatedMessages = [...state.messages, ...queuedAsMessages]
      const trimmed = updatedMessages.slice(-state.maxMessages)

      console.log('[MessagesState] Flushed', queuedAsMessages.length, 'queued messages')

      return withTokenEstimate({
        ...state,
        messages: trimmed,
        queuedUserMessages: [],
        streamingMessageIndex: null,
        isStreaming: false
      })
    }

    case 'command_completed': {
      console.log('[MessagesState] Processing command_completed')
      return addMessage(state, {
        id: generateId(),
        role: 'user',
        type: 'function_results',
        results: [{
          name: 'eval',
          success: true,
          output: event.result
        }],
        timestamp: Date.now()
      })
    }

    case 'command_failed': {
      console.log('[MessagesState] Processing command_failed')
      return addMessage(state, {
        id: generateId(),
        role: 'user',
        type: 'function_results',
        results: [{
          name: 'eval',
          success: false,
          error: event.error
        }],
        timestamp: Date.now()
      })
    }

    case 'execution_rejected': {
      console.log('[MessagesState] Processing execution_rejected')
      return addMessage(state, {
        id: generateId(),
        role: 'user',
        type: 'function_results',
        results: [{
          name: 'eval',
          success: false,
          error: 'Execution rejected by user'
        }],
        timestamp: Date.now()
      })
    }

    case 'interrupt_requested': {
      return addMessage(state, {
        id: generateId(),
        role: 'user',
        type: 'function_results',
        results: [{
          name: 'interrupt',
          success: false,
          error: 'Interrupted by user'
        }],
        timestamp: Date.now()
      })
    }

    default:
      return state
  }
  }
})
