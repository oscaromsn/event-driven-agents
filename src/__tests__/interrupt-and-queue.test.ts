// ============================================================================
// Interrupt and Message Queue Tests - EVENT-DRIVEN (NO SLEEPS!)
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { Effect, Layer, SubscriptionRef } from 'effect'
import { CommandExecutor } from '../services/command-executor.ts'
import { CommandState } from '../services/command-state.ts'
import { EventBus } from '../services/event-bus.ts'
import { InterruptState } from '../services/interrupt-state.ts'
import { MessagesState } from '../services/messages-state.ts'
import { UIDisplayState } from '../services/ui-display-state.ts'
import type { UIMessage } from '../shared-types.ts'
import { createMockLLMService } from './mocks/llm.ts'
import {
    waitForCondition,
    waitForInterruptComplete,
    waitForQueueEmpty,
    waitForQueueSize,
    waitForStreamingStart,
    waitForStreamingStop
} from './test-helpers.ts'
import { testLayer } from './test-utils.ts'

// Create full test layer with mock LLM
function createFullTestLayer(mockLLMConfig: { responses: string[]; chunkDelayMs?: number }) {
  const baseLayer = testLayer(EventBus, MessagesState, InterruptState, CommandState, UIDisplayState, CommandExecutor)
  const mockLLM = createMockLLMService(mockLLMConfig)
  // Provide EventBus to mockLLM, then merge with base
  const mockLLMWithDeps = mockLLM.pipe(Layer.provide(EventBus.Default))
  return Layer.merge(baseLayer, mockLLMWithDeps)
}

describe('Interrupt and Message Queue', () => {
  it('should queue messages sent during streaming', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState

      console.log('[TEST] Sending first message...')
      // Send first message - should start streaming
      yield* eventBus.publish({
        type: 'user_message',
        content: 'First message',
        timestamp: Date.now()
      })

      // WAIT FOR STREAMING TO START (event-driven)
      console.log('[TEST] Waiting for streaming to start...')
      yield* waitForStreamingStart(messagesState.state)
      console.log('[TEST] Streaming started!')

      console.log('[TEST] Sending messages during streaming...')
      // Send messages while streaming - they should queue
      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued message 1',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued message 2',
        timestamp: Date.now()
      })

      // WAIT FOR QUEUE TO HAVE 2 MESSAGES (event-driven)
      console.log('[TEST] Waiting for queue to fill...')
      const stateWithQueue = yield* waitForQueueSize(messagesState.state, 2)
      console.log('[TEST] Queue has', stateWithQueue.queuedUserMessages.length, 'messages')

      expect(stateWithQueue.queuedUserMessages.length).toBe(2)
      expect(stateWithQueue.queuedUserMessages[0].content).toBe('Queued message 1')
      expect(stateWithQueue.queuedUserMessages[1].content).toBe('Queued message 2')

      // WAIT FOR STREAMING TO COMPLETE (event-driven)
      console.log('[TEST] Waiting for streaming to complete...')
      const afterStreaming = yield* waitForStreamingStop(messagesState.state)
      console.log('[TEST] Streaming completed!')

      // WAIT FOR QUEUE TO BE FLUSHED (event-driven)
      console.log('[TEST] Waiting for queue to flush...')
      const finalState = yield* waitForQueueEmpty(messagesState.state)
      console.log('[TEST] Queue flushed! Final queue length:', finalState.queuedUserMessages.length)

      expect(finalState.queuedUserMessages.length).toBe(0)
      // Note: isStreaming might be true because it started processing queued messages!
      // That's correct behavior - queued messages trigger new LLM stream

      // Queued messages should now be in main messages
      const userMessages = finalState.messages.filter(m => m.role === 'user' && m.type === 'text')
      console.log('[TEST] Total user messages:', userMessages.length)
      expect(userMessages.length).toBeGreaterThanOrEqual(3)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createFullTestLayer({
          responses: [
            'First response that can be interrupted',
            'Second response for queued message',
            'Third response for another queued message'
          ],
          chunkDelayMs: 50
        })),
        Effect.scoped
      )
    )
  }, 10000)

  it('should interrupt LLM streaming when interrupt_requested', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState
      const interruptState = yield* InterruptState

      console.log('[TEST] Starting stream...')
      // Start streaming
      yield* eventBus.publish({
        type: 'user_message',
        content: 'Tell me a long story about dinosaurs and space travel',
        timestamp: Date.now()
      })

      // WAIT FOR STREAMING TO START
      console.log('[TEST] Waiting for streaming to start...')
      yield* waitForStreamingStart(messagesState.state)
      console.log('[TEST] Streaming started!')

      // Give it a tiny bit of time to accumulate some content (just a few chunks)
      // This is okay because we're waiting for a REAL condition after
      yield* Effect.sleep('150 millis')

      console.log('[TEST] Sending interrupt...')
      // Interrupt the stream
      yield* eventBus.publish({
        type: 'interrupt_requested',
        reason: 'User clicked stop'
      })

      // WAIT FOR INTERRUPT TO COMPLETE (event-driven)
      console.log('[TEST] Waiting for interrupt to complete...')
      yield* waitForInterruptComplete(interruptState.state)
      console.log('[TEST] Interrupt completed!')

      // WAIT FOR STREAMING TO STOP (event-driven)
      console.log('[TEST] Waiting for streaming to stop...')
      const afterInterrupt = yield* waitForStreamingStop(messagesState.state)
      console.log('[TEST] Streaming stopped!')

      expect(afterInterrupt.isStreaming).toBe(false)

      // Interrupt state should show interrupt completed
      const intValue = yield* SubscriptionRef.get(interruptState.state)
      console.log('[TEST] Interrupt state:', {
        requested: intValue.requestedCount,
        completed: intValue.completedCount,
        pending: intValue.isPending
      })
      expect(intValue.requestedCount).toBe(1)
      expect(intValue.completedCount).toBe(1)
      expect(intValue.isPending).toBe(false)

      // Message should exist (content may or may not be present depending on timing)
      const assistantMsg = afterInterrupt.messages.find(m => m.role === 'assistant' && m.type === 'text')
      console.log('[TEST] Assistant message exists:', !!assistantMsg)
      expect(assistantMsg).toBeDefined()
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createFullTestLayer({
          responses: [
            'First response that can be interrupted',
            'Second response for queued message',
            'Third response for another queued message'
          ],
          chunkDelayMs: 50
        })),
        Effect.scoped
      )
    )
  }, 10000)

  it('should preserve queued messages after interrupt', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState
      const interruptState = yield* InterruptState

      console.log('[TEST] Starting stream...')
      // Start streaming
      yield* eventBus.publish({
        type: 'user_message',
        content: 'First',
        timestamp: Date.now()
      })

      // WAIT FOR STREAMING TO START
      console.log('[TEST] Waiting for streaming to start...')
      yield* waitForStreamingStart(messagesState.state)
      console.log('[TEST] Streaming started!')

      console.log('[TEST] Queueing messages...')
      // Queue messages during streaming
      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued 1',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued 2',
        timestamp: Date.now()
      })

      // WAIT FOR QUEUE TO FILL
      console.log('[TEST] Waiting for queue to fill...')
      const beforeInterrupt = yield* waitForQueueSize(messagesState.state, 2)
      console.log('[TEST] Queue has', beforeInterrupt.queuedUserMessages.length, 'messages')
      expect(beforeInterrupt.queuedUserMessages.length).toBe(2)

      console.log('[TEST] Interrupting...')
      // Interrupt
      yield* eventBus.publish({
        type: 'interrupt_requested',
        reason: 'Stop'
      })

      // WAIT FOR INTERRUPT TO COMPLETE
      console.log('[TEST] Waiting for interrupt to complete...')
      yield* waitForInterruptComplete(interruptState.state)
      console.log('[TEST] Interrupt completed!')

      // WAIT FOR QUEUE TO BE FLUSHED
      console.log('[TEST] Waiting for queue to flush...')
      const afterInterrupt = yield* waitForQueueEmpty(messagesState.state)
      console.log('[TEST] Queue flushed! Messages:', afterInterrupt.queuedUserMessages.length)

      expect(afterInterrupt.queuedUserMessages.length).toBe(0)

      const userMessages = afterInterrupt.messages.filter(m => m.role === 'user' && m.type === 'text')
      console.log('[TEST] Total user messages:', userMessages.length)
      expect(userMessages.length).toBe(3)  // First + Queued 1 + Queued 2
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createFullTestLayer({
          responses: [
            'First response that can be interrupted',
            'Second response for queued message',
            'Third response for another queued message'
          ],
          chunkDelayMs: 50
        })),
        Effect.scoped
      )
    )
  }, 10000)

  it('should prevent multiple overlapping streams', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState

      console.log('[TEST] Sending multiple messages rapidly...')
      // Send multiple messages rapidly
      yield* eventBus.publish({
        type: 'user_message',
        content: 'Message 1',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Message 2',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Message 3',
        timestamp: Date.now()
      })

      // WAIT FOR STREAMING TO START
      console.log('[TEST] Waiting for streaming to start...')
      yield* waitForStreamingStart(messagesState.state)
      console.log('[TEST] Streaming started!')

      // WAIT FOR QUEUE TO HAVE 2 MESSAGES (Messages 2 and 3)
      console.log('[TEST] Waiting for queue to fill...')
      const state = yield* waitForQueueSize(messagesState.state, 2)
      console.log('[TEST] Queue filled!')

      console.log('[TEST] Streaming state:', state.isStreaming)
      console.log('[TEST] Streaming index:', state.streamingMessageIndex)
      console.log('[TEST] Queue size:', state.queuedUserMessages.length)

      // Should have ONE streaming message
      expect(state.streamingMessageIndex).not.toBe(null)

      // Messages 2 and 3 should be queued
      expect(state.queuedUserMessages.length).toBe(2)

      // Should only have ONE assistant message (streaming)
      const assistantMessages = state.messages.filter(m => m.role === 'assistant')
      console.log('[TEST] Assistant messages:', assistantMessages.length)
      expect(assistantMessages.length).toBe(1)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createFullTestLayer({
          responses: [
            'First response that can be interrupted',
            'Second response for queued message',
            'Third response for another queued message'
          ],
          chunkDelayMs: 50
        })),
        Effect.scoped
      )
    )
  }, 10000)

  it('should show queued messages in UI with queued=true flag', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState
      const uiDisplayState = yield* UIDisplayState

      console.log('[TEST] Starting stream...')
      // Start streaming
      yield* eventBus.publish({
        type: 'user_message',
        content: 'First',
        timestamp: Date.now()
      })

      // WAIT FOR STREAMING TO START
      console.log('[TEST] Waiting for streaming to start...')
      yield* waitForStreamingStart(messagesState.state)
      console.log('[TEST] Streaming started!')

      console.log('[TEST] Sending messages to queue...')
      // Send messages - should queue
      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued A',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Queued B',
        timestamp: Date.now()
      })

      // WAIT FOR QUEUE TO FILL
      console.log('[TEST] Waiting for queue to fill...')
      yield* waitForQueueSize(messagesState.state, 2)
      console.log('[TEST] Queue filled!')

      // WAIT FOR UI TO UPDATE (use condition on UI state)
      console.log('[TEST] Waiting for UI to show queued messages...')
      const ui = yield* waitForCondition(
        uiDisplayState.state,
        state => state.messages.filter(m => m.type === 'user_message' && m.queued === true).length === 2
      )
      console.log('[TEST] UI updated!')

      console.log('[TEST] UI phase:', ui.status.phase)
      console.log('[TEST] Total messages in UI:', ui.messages.length)

      // Find queued messages in UI
      const userMessages = ui.messages.filter((m): m is Extract<UIMessage, { type: 'user_message' }> => m.type === 'user_message')
      const queuedMessages = userMessages.filter(m => m.queued)
      const normalMessages = userMessages.filter(m => !m.queued)

      console.log('[TEST] Queued messages in UI:', queuedMessages.length)
      console.log('[TEST] Normal messages in UI:', normalMessages.length)

      expect(queuedMessages.length).toBe(2)
      expect(queuedMessages[0].content).toBe('Queued A')
      expect(queuedMessages[1].content).toBe('Queued B')

      // UI should show as streaming
      expect(ui.status.phase).toBe('streaming')

      // Should allow interrupts during streaming
      expect(ui.actions.canInterrupt).toBe(true)

      // Should still allow sending messages (they queue)
      expect(ui.actions.canSendMessage).toBe(true)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createFullTestLayer({
          responses: [
            'First response that can be interrupted',
            'Second response for queued message',
            'Third response for another queued message'
          ],
          chunkDelayMs: 50
        })),
        Effect.scoped
      )
    )
  }, 10000)
})
