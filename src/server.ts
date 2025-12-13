// ============================================================================
// WebSocket Server
// ============================================================================

// Load visualizer instrumentation FIRST (wraps Effect primitives)
import './visualizer/instrumentation.ts'

import { Effect, Layer } from 'effect'
import { EventBus } from './services/event-bus.ts'
import { VisualizerSink } from './services/visualizer-sink.ts'
import { WebSocketSink } from './services/websocket-sink.ts'

import { CommandExecutor } from './services/command-executor.ts'
import { CommandParser } from './services/command-parser.ts'
import { InterruptState } from './services/interrupt-state.ts'
import { LLMService } from './services/llm-service.ts'

// Register services for visualizer (must happen after service imports)
import './visualizer/service-config.ts'

type WebSocketData = { type: 'main' | 'visualizer' }

// With Effect.Service() dependencies: only provide services the program uses directly
// WebSocketSink auto-provides: UIDisplayState → MessagesState, CommandState, InterruptState → EventBus
// But we need to provide all services that need to be started
const AppLive = Layer.mergeAll(
  EventBus.Default,
  WebSocketSink.Default,
  VisualizerSink.Default,
  InterruptState.Default,  // Needs to be started to listen for interrupt events
  LLMService.Default,
  CommandParser.Default,
  CommandExecutor.Default
)

// Start everything
const program = Effect.gen(function* () {

  const eventBus = yield* EventBus
  const webSocketSink = yield* WebSocketSink
  const visualizerSink = yield* VisualizerSink

  // Initialize background services by yielding them
  yield* InterruptState
  yield* LLMService
  yield* CommandParser
  yield* CommandExecutor

  console.log('🚀 Starting Dataflow POC...')

  // Start Bun WebSocket server
  const server = Bun.serve<WebSocketData>({
    port: 3457,
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, { data: { type: 'main' } })
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 500 })
        }
        return undefined
      }
      if (url.pathname === '/visualizer') {
        const upgraded = server.upgrade(req, { data: { type: 'visualizer' } })
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 500 })
        }
        return undefined
      }
      return new Response('Not found', { status: 404 })
    },

    websocket: {
      open(ws) {
        if (ws.data.type === 'visualizer') {
          Effect.runPromise(visualizerSink.addClient(ws))
          console.log('✓ Visualizer client connected')
        } else {
          Effect.runPromise(webSocketSink.addClient(ws))
          console.log('✓ Main client connected')
        }
      },

      async message(ws, message) {
        if (ws.data.type === 'visualizer') {
          // Visualizer clients don't send messages
          return
        }

        const data = JSON.parse(message.toString())

        switch (data.type) {
          case 'user_message':
            await Effect.runPromise(
              eventBus.publish({
                type: 'user_message',
                content: data.content,
                timestamp: Date.now()
              })
            )
            break

          case 'execution_approved':
            await Effect.runPromise(
              eventBus.publish({
                type: 'execution_approved',
                commandId: data.commandId
              })
            )
            break

          case 'execution_rejected':
            await Effect.runPromise(
              eventBus.publish({
                type: 'execution_rejected',
                commandId: data.commandId,
                reason: data.reason || 'User rejected'
              })
            )
            break

          case 'interrupt_requested':
            await Effect.runPromise(
              eventBus.publish({
                type: 'interrupt_requested',
                reason: data.reason || 'User stopped'
              })
            )
            break
        }
      },

      close(ws) {
        if (ws.data.type === 'visualizer') {
          Effect.runPromise(visualizerSink.removeClient(ws))
          console.log('✗ Visualizer client disconnected')
        } else {
          Effect.runPromise(webSocketSink.removeClient(ws))
          console.log('✗ Main client disconnected')
        }
      }
    }
  })

  console.log(`🚀 Server running on ws://localhost:${server.port}/ws`)

  // Keep running
  yield* Effect.never
})

// Run
await Effect.runPromise(
  program.pipe(
    Effect.provide(AppLive),
    Effect.scoped
  )
)
