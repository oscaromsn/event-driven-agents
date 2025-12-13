// ============================================================================
// WebSocket Sink Service
// ============================================================================

import type { ServerWebSocket } from 'bun'
import { Effect, Ref, Stream, SubscriptionRef, pipe } from '../visualizer/effect-wrapper.ts'
import { UIDisplayState } from './ui-display-state.ts'

export class WebSocketSink extends Effect.Service<WebSocketSink>()('WebSocketSink', {
  scoped: Effect.gen(function* () {
    const uiDisplayState = yield* UIDisplayState
    const clients = yield* Ref.make(new Set<ServerWebSocket<unknown>>())

    const broadcast = (message: any) =>
      pipe(
        Ref.get(clients),
        Effect.map(clientSet => {
          const json = JSON.stringify(message)
          for (const client of clientSet) {
            client.send(json)
          }
        })
      )

    // Subscribe to UI display updates and broadcast
    yield* Stream.runForEach(
      uiDisplayState.stream,
      (display) =>
        broadcast({
          type: 'display_update',
          display
        })
    ).pipe(Effect.forkScoped)

    return {
      broadcast,
      addClient: (ws: ServerWebSocket<unknown>) =>
        pipe(
          Ref.update(clients, s => {
            const newSet = new Set(s)
            newSet.add(ws)
            return newSet
          }),
          Effect.flatMap(() => SubscriptionRef.get(uiDisplayState.state)),
          Effect.map(currentState => {
            // Send current state to newly connected client
            ws.send(JSON.stringify({
              type: 'display_update',
              display: currentState
            }))
          })
        ),
      removeClient: (ws: ServerWebSocket<unknown>) =>
        Ref.update(clients, s => {
          const newSet = new Set(s)
          newSet.delete(ws)
          return newSet
        }),
      start: Effect.void
    }
  }),
  dependencies: [UIDisplayState.Default]
}) {}
