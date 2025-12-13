// ============================================================================
// Command Executor Service
// ============================================================================

import { makeInterruptible } from '../utils/interruptible.ts'
import { Effect, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { CommandState } from './command-state.ts'
import { EventBus } from './event-bus.ts'

export class CommandExecutor extends Effect.Service<CommandExecutor>()('CommandExecutor', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus
    const commandState = yield* CommandState

    // Subscribe to command starts
    const starts = yield* eventBus.subscribe(
      (e): e is { type: 'command_started'; commandId: string } =>
        e.type === 'command_started'
    )

    yield* Stream.runForEach(starts, (event) =>
      Effect.gen(function* () {
        const stateValue = yield* SubscriptionRef.get(commandState.state)
        const command = stateValue.commands.get(event.commandId)

        if (!command || command.command !== 'eval') return

        console.log('[CommandExecutor] Executing:', event.commandId)

        const result = yield* makeInterruptible(
          evalCode(command.params.code),
          eventBus
        )

        // Handle result based on tag
        if (result._tag === 'Failed') {
          console.log('[CommandExecutor] Execution failed')
          yield* eventBus.publish({
            type: 'command_failed',
            commandId: event.commandId,
            error: result.error instanceof Error ? result.error.message : 'Unknown error'
          })
        } else if (result._tag === 'Interrupted') {
          console.log('[CommandExecutor] Execution interrupted')
          yield* eventBus.publish({
            type: 'command_failed',
            commandId: event.commandId,
            error: 'Execution interrupted by user'
          })
          yield* eventBus.publish({
            type: 'interrupt_cleanup_completed'
          })
        } else {
          console.log('[CommandExecutor] Execution completed')
          yield* eventBus.publish({
            type: 'command_completed',
            commandId: event.commandId,
            result: result.value
          })
        }
      }).pipe(
        Effect.tap(() => Effect.sync(() => console.log('[CommandExecutor] Effect.gen completed successfully'))),
        Effect.catchAll((error: Error) => {
          console.log('[CommandExecutor] CATCHALL TRIGGERED')
          console.log('[CommandExecutor] ERROR:', error)
          return eventBus.publish({
            type: 'command_failed',
            commandId: event.commandId,
            error: error.message
          })
        })
      )
    ).pipe(Effect.forkScoped)

    return {
      start: Effect.void
    }
  }),
  dependencies: [EventBus.Default, CommandState.Default]
}) {}

// Simple eval executor - just evaluates TS/JS code
function evalCode(code: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    console.log('[evalCode] Running:', code.slice(0, 50))
    try {
      const result = eval(code)
      console.log('[evalCode] Success:', result)
      return String(result)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.log('[evalCode] Caught eval error, creating Effect.fail with:', errorMsg)
      const failEffect = Effect.fail(new Error(errorMsg))
      console.log('[evalCode] About to yield failEffect')
      return yield* failEffect
    }
  })
}
