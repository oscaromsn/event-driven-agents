// ============================================================================
// Event Bus Service
// ============================================================================

import type { Event } from '../events.ts'
import { Effect, PubSub, Stream, pipe } from '../visualizer/effect-wrapper.ts'

// Helper type to extract events by their type field
type EventOfType<T extends Event['type']> = Extract<Event, { type: T }>

export class EventBus extends Effect.Service<EventBus>()('EventBus', {
  scoped: Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<Event>(1000)

    return {
      publish: (event: Event) =>
        pipe(
          PubSub.publish(pubsub, event),
          Effect.tap(() =>
            Effect.sync(() => console.log('[EventBus]', event.type))
          )
        ),

      subscribe: <E extends Event>(filter: (event: Event) => event is E) =>
        Stream.fromPubSub(pubsub, { scoped: true }).pipe(
          Effect.map(stream => stream.pipe(Stream.filter(filter)))
        ),

      // Subscribe to multiple event types with automatic type narrowing
      subscribeToTypes: <T extends Event['type'][]>(...types: T) =>
        Stream.fromPubSub(pubsub, { scoped: true }).pipe(
          Effect.map(stream =>
            stream.pipe(
              Stream.filter((event): event is EventOfType<T[number]> =>
                types.includes(event.type as any)
              )
            )
          )
        )
    }
  })
}) {}
