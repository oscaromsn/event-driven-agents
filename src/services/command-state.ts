// ============================================================================
// Command State Service
// ============================================================================

import { commandReducer, type CommandStateType } from '../reducers/command-reducer.ts'
import { Effect, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { EventBus } from './event-bus.ts'

export class CommandState extends Effect.Service<CommandState>()('CommandState', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus

    const commandRef = yield* SubscriptionRef.make<CommandStateType>(
      commandReducer.initialState,
      'CommandState'
    )

    const events = yield* eventBus.subscribeToTypes(...commandReducer.eventTypes)

    yield* Stream.runForEach(events, event =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(commandRef, state => commandReducer.reduce(state, event))

        // Side effect: publish command_started after approval
        if (event.type === 'execution_approved') {
          yield* eventBus.publish({
            type: 'command_started',
            commandId: event.commandId
          })
        }
      })
    ).pipe(Effect.forkScoped)

    return {
      state: commandRef,
      stream: commandRef.changes
    }
  }),
  dependencies: [EventBus.Default]
}) {}
