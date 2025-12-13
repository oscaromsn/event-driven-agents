// ============================================================================
// Test Utilities
// ============================================================================

import { Layer } from 'effect'
import { CommandExecutor } from '../services/command-executor.ts'
import { CommandParser } from '../services/command-parser.ts'
import { CommandState } from '../services/command-state.ts'
import { EventBus } from '../services/event-bus.ts'
import { InterruptState } from '../services/interrupt-state.ts'
import { LLMMemoryState } from '../services/llm-memory-state.ts'
import { LLMService } from '../services/llm-service.ts'
import { MessagesState } from '../services/messages-state.ts'
import { UIDisplayState } from '../services/ui-display-state.ts'
import { WebSocketSink } from '../services/websocket-sink.ts'

/**
 * Creates a test layer. Just pass the services your test program uses DIRECTLY.
 * The dependencies field in Effect.Service() does NOT make deps available to your
 * program - it only provides them to the service implementation itself.
 *
 * So if your test does `yield* EventBus` AND `yield* MessagesState`, you must
 * pass BOTH, even though MessagesState depends on EventBus.
 *
 * @example
 * // Test uses EventBus and MessagesState:
 * const layer = testLayer(EventBus, MessagesState)
 *
 * // Test only uses MessagesState (doesn't yield* EventBus):
 * const layer = testLayer(MessagesState)
 */
type ServiceClass =
  | typeof EventBus
  | typeof MessagesState
  | typeof CommandState
  | typeof InterruptState
  | typeof LLMMemoryState
  | typeof UIDisplayState
  | typeof CommandExecutor
  | typeof CommandParser
  | typeof LLMService
  | typeof WebSocketSink

export function testLayer<Services extends ServiceClass[]>(...services: Services): Layer.Layer<InstanceType<Services[number]>, never, never> {
  if (services.length === 0) {
    throw new Error('testLayer requires at least one service')
  }

  const layers = services.map(s => s.Default)
  const [first, ...rest] = layers

  let result: Layer.Layer<InstanceType<Services[number]>, never, never> = first as Layer.Layer<InstanceType<Services[number]>, never, never>
  for (const layer of rest) {
    result = Layer.merge(result, layer as Layer.Layer<InstanceType<Services[number]>, never, never>) as Layer.Layer<InstanceType<Services[number]>, never, never>
  }

  return result
}

/**
 * Common test layer combinations
 */
export const TestLayers = {
  /** EventBus only */
  eventBus: testLayer(EventBus),

  /** EventBus + MessagesState */
  messages: testLayer(EventBus, MessagesState),

  /** EventBus + CommandState */
  commands: testLayer(EventBus, CommandState),

  /** EventBus + MessagesState + CommandState */
  state: testLayer(EventBus, MessagesState, CommandState),

  /** Full UI stack: UIDisplayState auto-provides everything below */
  ui: testLayer(EventBus, UIDisplayState),
}
