// ============================================================================
// Reducer Interface - Standard Pattern for State Reducers
// ============================================================================

import type { Event } from '../events.ts'

/**
 * Reducer function type - a pure function that applies an event to state.
 *
 * @template State - The state type this reducer manages
 * @template EventTypes - Readonly array of event type strings this reducer handles
 */
export type ReducerFn<State, EventTypes extends readonly Event['type'][]> = (
  state: State,
  event: Extract<Event, { type: EventTypes[number] }>
) => State

/**
 * Complete reducer - everything needed to use a reducer.
 *
 * @template State - The state type
 * @template EventTypes - The event types handled
 */
export type Reducer<State, EventTypes extends readonly Event['type'][]> = {
  /** The initial state value */
  initialState: State

  /** Array of event types this reducer handles */
  eventTypes: EventTypes

  /** Pure reducer function */
  reduce: ReducerFn<State, EventTypes>
}

/**
 * Helper to define a properly typed reducer.
 *
 * @example
 * ```typescript
 * export const counterReducer = defineReducer<CounterState>()({
 *   initialState: { count: 0 },
 *   eventTypes: ['increment', 'decrement'] as const,
 *   reduce: (state, event) => {
 *     switch (event.type) {
 *       case 'increment': return { ...state, count: state.count + 1 }
 *       case 'decrement': return { ...state, count: state.count - 1 }
 *     }
 *   }
 * })
 *
 * // Then in service:
 * const stateRef = yield* SubscriptionRef.make(counterReducer.initialState)
 * const events = yield* eventBus.subscribeToTypes(...counterReducer.eventTypes)
 * yield* SubscriptionRef.update(stateRef, s => counterReducer.reduce(s, event))
 * ```
 */
export const defineReducer = <State>() => <const EventTypes extends readonly Event['type'][]>(
  reducer: {
    initialState: State
    eventTypes: EventTypes
    reduce: ReducerFn<State, EventTypes>
  }
): Reducer<State, EventTypes> => reducer
