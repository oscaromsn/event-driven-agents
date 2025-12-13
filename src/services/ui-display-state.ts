// ============================================================================
// UI Display State Service (Derived)
// ============================================================================

import type {
    UIActions,
    UIApprovalPrompt,
    UIDisplayState as UIDisplayStateType,
    UIMessage,
    UIStatus
} from '../shared-types.ts'
import { Effect, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { CommandState } from './command-state.ts'
import { InterruptState } from './interrupt-state.ts'
import { MessagesState } from './messages-state.ts'

export type { UIActions, UIApprovalPrompt, UIDisplayStateType, UIMessage, UIStatus }

export class UIDisplayState extends Effect.Service<UIDisplayState>()('UIDisplayState', {
  scoped: Effect.gen(function* () {
    const messagesState = yield* MessagesState
    const commandState = yield* CommandState
    const interruptState = yield* InterruptState

    // Create initial state
    const initialState: UIDisplayStateType = {
      messages: [],
      status: { phase: 'idle', message: 'Ready' },
      approvalPrompt: null,
      actions: {
        canSendMessage: true,
        canApprove: false,
        canReject: false,
        canInterrupt: false
      }
    }

    const stateRef = yield* SubscriptionRef.make(initialState, 'UIDisplayState')

    // Combine all state streams
    const displayStream = Stream.zipLatest(
      messagesState.state.changes,
      Stream.zipLatest(
        commandState.state.changes,
        interruptState.state.changes
      )
    ).pipe(
      Stream.map(([messagesValue, [commandsValue, interruptValue]]) => {
        // Get the currently streaming message ID if any
        const streamingMessageId = messagesValue.streamingMessageIndex !== null
          ? messagesValue.messages[messagesValue.streamingMessageIndex]?.id
          : null

        // Convert messages to UI format
        const uiMessages: UIMessage[] = messagesValue.messages
          .flatMap((m): UIMessage[] => {
            switch (m.type) {
              case 'text':
                if (m.role === 'user') {
                  return [{
                    id: m.id,
                    type: 'user_message' as const,
                    content: m.content,
                    timestamp: m.timestamp,
                    queued: false
                  }]
                } else {
                  return [{
                    id: m.id,
                    type: 'assistant_message' as const,
                    content: m.content,
                    timestamp: m.timestamp,
                    streaming: m.id === streamingMessageId
                  }]
                }
              case 'function_results':
                // Convert each result to a separate UI message
                return m.results.map((result, idx): UIMessage => {
                  // Special handling for rejection and interrupt
                  if (result.name === 'eval' && !result.success && result.error === 'Execution rejected by user') {
                    return {
                      id: `${m.id}_${idx}`,
                      type: 'execution_rejected',
                      timestamp: m.timestamp
                    }
                  }
                  if (result.name === 'interrupt' && !result.success && result.error === 'Interrupted by user') {
                    return {
                      id: `${m.id}_${idx}`,
                      type: 'interrupt',
                      timestamp: m.timestamp
                    }
                  }
                  // Regular tool result
                  return {
                    id: `${m.id}_${idx}`,
                    type: 'tool_result',
                    toolName: result.name,
                    success: result.success,
                    output: result.success ? result.output : result.error,
                    timestamp: m.timestamp,
                    streaming: false,
                    queued: false
                  }
                })
              case 'function_calls':
                // Don't show function_calls in UI - they're implementation details
                return []
            }
          })
          .concat(
            // Add queued messages as queued=true
            messagesValue.queuedUserMessages.map(q => ({
              id: q.id,
              type: 'user_message' as const,
              content: q.content,
              timestamp: q.timestamp,
              queued: true
            }))
          )

        // Find pending approval
        let approvalPrompt: UIApprovalPrompt | null = null
        for (const command of commandsValue.commands.values()) {
          if (command.status === 'requested') {
            approvalPrompt = {
              commandId: command.commandId,
              code: command.params.code,
              description: command.params.description
            }
            break
          }
        }

        // Determine phase
        let phase: UIStatus['phase'] = 'idle'
        let statusMessage = 'Ready'

        if (interruptValue.isPending) {
          phase = 'interrupting'
          statusMessage = 'Stopping...'
        } else if (approvalPrompt) {
          phase = 'awaiting_approval'
          statusMessage = 'Awaiting execution approval'
        } else if (messagesValue.streamingMessageIndex !== null) {
          phase = 'streaming'
          statusMessage = 'Streaming response...'
        } else {
          // Check for executing commands
          for (const command of commandsValue.commands.values()) {
            if (command.status === 'started' || command.status === 'approved') {
              phase = 'executing'
              statusMessage = 'Executing code...'
              break
            }
          }
        }

        const status: UIStatus = { phase, message: statusMessage }

        // Determine available actions
        const actions: UIActions = {
          canSendMessage: true,  // Always allow sending (messages queue during streaming)
          canApprove: phase === 'awaiting_approval',
          canReject: phase === 'awaiting_approval',
          canInterrupt: phase === 'streaming' || phase === 'executing'
        }

        const newState: UIDisplayStateType = {
          messages: uiMessages,
          status,
          approvalPrompt,
          actions
        }

        return newState
      })
    )

    // Update the ref whenever the stream changes
    yield* Stream.runForEach(displayStream, state =>
      SubscriptionRef.set(stateRef, state)
    ).pipe(Effect.forkScoped)

    return {
      stream: stateRef.changes,
      state: stateRef
    }
  }),
  dependencies: [MessagesState.Default, CommandState.Default, InterruptState.Default]
}) {}

export const UIDisplayStateLive = UIDisplayState.Default
