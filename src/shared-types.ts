// ============================================================================
// Shared Types - Used by both backend and frontend
// ============================================================================

/**
 * UI Message displayed in chat
 */
export type UIMessage =
  | {
      id: string
      type: 'user_message'
      content: string
      timestamp: number
      queued: boolean
    }
  | {
      id: string
      type: 'assistant_message'
      content: string
      timestamp: number
      streaming: boolean
    }
  | {
      id: string
      type: 'tool_result'
      toolName: string
      success: boolean
      output: string
      timestamp: number
      streaming: false
      queued: false
    }
  | {
      id: string
      type: 'execution_rejected'
      timestamp: number
    }
  | {
      id: string
      type: 'interrupt'
      timestamp: number
    }

/**
 * Approval prompt for code execution
 */
export type UIApprovalPrompt = {
  commandId: string
  code: string
  description?: string
}

/**
 * System status and phase
 */
export type UIStatus = {
  phase: 'idle' | 'streaming' | 'awaiting_approval' | 'executing' | 'interrupting'
  message: string
}

/**
 * Available user actions
 */
export type UIActions = {
  canSendMessage: boolean
  canApprove: boolean
  canReject: boolean
  canInterrupt: boolean
}

/**
 * Complete UI display state
 */
export type UIDisplayState = {
  messages: UIMessage[]
  status: UIStatus
  approvalPrompt: UIApprovalPrompt | null
  actions: UIActions
}

/**
 * WebSocket message from client to server
 */
export type ClientMessage =
  | { type: 'user_message'; content: string }
  | { type: 'execution_approved'; commandId: string }
  | { type: 'execution_rejected'; commandId: string; reason: string }
  | { type: 'interrupt_requested'; reason: string }

/**
 * WebSocket message from server to client
 */
export type ServerMessage = {
  type: 'display_update'
  display: UIDisplayState
}
