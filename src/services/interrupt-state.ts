// ============================================================================
// Interrupt State Service
// ============================================================================

import { interruptReducer, type InterruptStateType } from '../reducers/interrupt-reducer.ts'
import { Effect, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { EventBus } from './event-bus.ts'

export class InterruptState extends Effect.Service<InterruptState>()('InterruptState', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus

    const stateRef = yield* SubscriptionRef.make<InterruptStateType>(
      interruptReducer.initialState,
      'InterruptState'
    )

    const events = yield* eventBus.subscribeToTypes(...interruptReducer.eventTypes)

    yield* Stream.runForEach(events, event =>
      SubscriptionRef.update(stateRef, state => interruptReducer.reduce(state, event))
    ).pipe(Effect.forkScoped)

    return {
      state: stateRef,
      stream: stateRef.changes
    }
  }),
  dependencies: [EventBus.Default]
}) {}

export const InterruptStateLive = InterruptState.Default
