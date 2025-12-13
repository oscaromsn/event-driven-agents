// ============================================================================
// Simple Direct Tests
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { Effect, SubscriptionRef } from 'effect'
import { CommandState } from '../services/command-state.ts'
import { EventBus } from '../services/event-bus.ts'
import { MessagesState } from '../services/messages-state.ts'
import { testLayer } from './test-utils.ts'

describe('Direct Service Tests', () => {
  it('EventBus: should create successfully', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      expect(eventBus).toBeDefined()
      expect(typeof eventBus.publish).toBe('function')
      expect(typeof eventBus.subscribe).toBe('function')
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(EventBus.Default),
        Effect.scoped
      )
    )
  })

  it('MessagesState: should start with empty messages', async () => {
    const program = Effect.gen(function* () {
      const messagesState = yield* MessagesState
      const state = yield* SubscriptionRef.get(messagesState.state)

      expect(state.messages).toEqual([])
      expect(state.maxMessages).toBe(100)
      expect(state.streamingMessageIndex).toBe(null)
      expect(state.tokenEstimate).toBe(0)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(MessagesState.Default),
        Effect.scoped
      )
    )
  })

  it('CommandState: should start with no commands', async () => {
    const program = Effect.gen(function* () {
      const commandState = yield* CommandState
      const state = yield* SubscriptionRef.get(commandState.state)

      expect(state.commands.size).toBe(0)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(CommandState.Default),
        Effect.scoped
      )
    )
  })

  it('EventBus: should publish events', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus

      // Publish should not throw
      yield* eventBus.publish({
        type: 'user_message',
        content: 'test',
        timestamp: Date.now()
      })

      // Publish another event
      yield* eventBus.publish({
        type: 'llm_response_started',
        streamId: 'test'
      })
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(EventBus.Default),
        Effect.scoped
      )
    )
  })

  it('MessagesState: should update when publishing user_message', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const messagesState = yield* MessagesState

      yield* eventBus.publish({
        type: 'user_message',
        content: 'Hello',
        timestamp: Date.now()
      })

      // Give time for the event to be processed
      yield* Effect.sleep('300 millis')

      const state = yield* SubscriptionRef.get(messagesState.state)

      // Should have the user message
      expect(state.messages.length).toBeGreaterThanOrEqual(1)
      const userMsg = state.messages.find(m => m.role === 'user' && m.type === 'text')
      expect(userMsg).toBeDefined()
      if (userMsg?.type === 'text') {
        expect(userMsg.content).toBe('Hello')
      }
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus, MessagesState)),
        Effect.scoped
      )
    )
  })

  it('CommandState: should track requested command', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState

      const commandId = 'test_cmd'

      yield* eventBus.publish({
        type: 'command_requested',
        commandId,
        command: 'eval',
        params: { code: '1 + 1' }
      })

      yield* Effect.sleep('200 millis')

      const state = yield* SubscriptionRef.get(commandState.state)
      const command = state.commands.get(commandId)

      expect(command).toBeDefined()
      expect(command?.status).toBe('requested')
      expect(command?.command).toBe('eval')
      expect(command?.params.code).toBe('1 + 1')
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus, CommandState)),
        Effect.scoped
      )
    )
  })
})
