// ============================================================================
// Visualizer Sink Service
// ============================================================================

import type { ServerWebSocket } from 'bun'
import type { Event } from '../events.ts'
import { Effect, setStateUpdateEmitter, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { deriveGraph } from '../visualizer/registry.ts'
import { EventBus } from './event-bus.ts'

export type VisualizerMessage =
  | {
      type: 'graph_structure'
      data: ReturnType<typeof deriveGraph>
    }
  | {
      type: 'live_event'
      event: Event
      timestamp: number
    }

export class VisualizerSink extends Effect.Service<VisualizerSink>()('VisualizerSink', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus
    const clientsRef = yield* SubscriptionRef.make<Set<ServerWebSocket<unknown>>>(new Set())

    // Setup state update emitter - use a mutable Set we can access synchronously
    let clientsSet = new Set<ServerWebSocket<unknown>>()

    setStateUpdateEmitter((stateEvent) => {
      const message = {
        type: 'live_event',
        event: stateEvent,
        timestamp: stateEvent.timestamp
      }
      clientsSet.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify(message))
        }
      })
    })

    // Subscribe to ALL events
    const allEvents = yield* eventBus.subscribe((e): e is Event => true)

    // Broadcast all events to visualizer clients
    yield* Stream.runForEach(allEvents, (event) =>
      Effect.gen(function* () {
        const clients = yield* SubscriptionRef.get(clientsRef)
        const message: VisualizerMessage = {
          type: 'live_event',
          event,
          timestamp: Date.now(),
        }

        clients.forEach((client) => {
          if (client.readyState === 1) {
            // OPEN
            client.send(JSON.stringify(message))
          }
        })
      })
    ).pipe(Effect.forkScoped)

    return {
      addClient: (ws: ServerWebSocket<unknown>) =>
        Effect.gen(function* () {
          // Update both the ref and the mutable set
          clientsSet.add(ws)
          yield* SubscriptionRef.update(clientsRef, (clients) => {
            const newClients = new Set(clients)
            newClients.add(ws)
            return newClients
          })

          // Send graph structure immediately on connect
          const graphStructure = deriveGraph()
          const message: VisualizerMessage = {
            type: 'graph_structure',
            data: graphStructure,
          }
          ws.send(JSON.stringify(message))

          console.log('[VisualizerSink] Client connected, sent graph structure')
        }),

      removeClient: (ws: ServerWebSocket<unknown>) =>
        Effect.gen(function* () {
          // Update both the ref and the mutable set
          clientsSet.delete(ws)
          yield* SubscriptionRef.update(clientsRef, (clients) => {
            const newClients = new Set(clients)
            newClients.delete(ws)
            return newClients
          })
        })
    }
  }),
  dependencies: [EventBus.Default]
}) {}
