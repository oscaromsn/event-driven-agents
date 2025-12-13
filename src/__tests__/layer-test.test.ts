// Test to figure out layer composition
import { describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { CommandState } from '../services/command-state.ts'
import { EventBus } from '../services/event-bus.ts'
import { MessagesState } from '../services/messages-state.ts'
import { testLayer } from './test-utils.ts'

describe('Layer Composition Test', () => {
  it('Can compose EventBus + MessagesState', async () => {
    const TestLayer = testLayer(EventBus, MessagesState)

    const program = Effect.gen(function* () {
      const messagesState = yield* MessagesState
      const state = yield* messagesState.state.get
      expect(state.messages).toEqual([])
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(TestLayer),
        Effect.scoped
      )
    )
  })

  it('Can compose EventBus + MessagesState + CommandState', async () => {
    const TestLayer = testLayer(EventBus, MessagesState, CommandState)

    const program = Effect.gen(function* () {
      const messagesState = yield* MessagesState
      const commandState = yield* CommandState

      const msgState = yield* messagesState.state.get
      const cmdState = yield* commandState.state.get

      expect(msgState.messages).toEqual([])
      expect(cmdState.commands.size).toBe(0)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(TestLayer),
        Effect.scoped
      )
    )
  })
})
