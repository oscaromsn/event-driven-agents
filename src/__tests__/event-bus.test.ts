// ============================================================================
// Event Bus Tests
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { Chunk, Effect, Fiber, Stream } from 'effect'
import type { Event } from '../events.ts'
import { EventBus } from '../services/event-bus.ts'
import { testLayer } from './test-utils.ts'

describe('EventBus', () => {
  it('should publish and subscribe to events', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus

      // Subscribe to all events - this IMMEDIATELY creates the subscription
      const allEvents = yield* eventBus.subscribe((e): e is Event => true)

      // Start collecting events in background
      const collectFiber = yield* Stream.runCollect(Stream.take(allEvents, 2)).pipe(Effect.fork)

      // Now publish events
      yield* eventBus.publish({
        type: 'user_message',
        content: 'test',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'llm_response_started',
        streamId: 'test_stream'
      })

      // Wait for collection to complete
      const eventsChunk = yield* Fiber.join(collectFiber)
      const events = Chunk.toReadonlyArray(eventsChunk)

      // Verify events were received
      expect(events.length).toBe(2)
      expect(events[0].type).toBe('user_message')
      expect(events[1].type).toBe('llm_response_started')
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus)),
        Effect.scoped
      )
    )
  })

  it('should filter events by type', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus

      // Subscribe only to user_message events - IMMEDIATELY creates subscription
      const userMessageStream = yield* eventBus.subscribe(
        (e): e is Extract<Event, { type: 'user_message' }> =>
          e.type === 'user_message'
      )

      // Start collecting
      const collectFiber = yield* Stream.runCollect(Stream.take(userMessageStream, 2)).pipe(Effect.fork)

      // Publish various events
      yield* eventBus.publish({
        type: 'user_message',
        content: 'test1',
        timestamp: Date.now()
      })

      yield* eventBus.publish({
        type: 'llm_response_started',
        streamId: 'test_stream'
      })

      yield* eventBus.publish({
        type: 'user_message',
        content: 'test2',
        timestamp: Date.now()
      })

      const userMessagesChunk = yield* Fiber.join(collectFiber)
      const userMessages = Chunk.toReadonlyArray(userMessagesChunk)

      // Should only receive user_message events
      expect(userMessages.length).toBe(2)
      expect(userMessages.every(e => e.type === 'user_message')).toBe(true)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus)),
        Effect.scoped
      )
    )
  })

  it('should support multiple subscribers', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus

      // Subscribe - these IMMEDIATELY create subscriptions
      const stream1 = yield* eventBus.subscribe((e): e is Event => true)
      const stream2 = yield* eventBus.subscribe((e): e is Event => true)

      // Start both collectors
      const fiber1 = yield* Stream.runCollect(Stream.take(stream1, 1)).pipe(Effect.fork)
      const fiber2 = yield* Stream.runCollect(Stream.take(stream2, 1)).pipe(Effect.fork)

      // Publish
      yield* eventBus.publish({
        type: 'user_message',
        content: 'test',
        timestamp: Date.now()
      })

      // Both subscribers should receive the event
      const events1Chunk = yield* Fiber.join(fiber1)
      const events2Chunk = yield* Fiber.join(fiber2)
      const events1 = Chunk.toReadonlyArray(events1Chunk)
      const events2 = Chunk.toReadonlyArray(events2Chunk)

      expect(events1.length).toBe(1)
      expect(events2.length).toBe(1)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus)),
        Effect.scoped
      )
    )
  })
})
