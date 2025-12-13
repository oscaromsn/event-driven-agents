// ============================================================================
// Interruptible Effect Utilities
// ============================================================================
//
// Generalized pattern for making long-running operations interruptible
// via interrupt_requested events from the EventBus.
//

import { Deferred, Effect, Scope, Stream } from 'effect'
import type { EventBus } from '../services/event-bus.ts'

/**
 * Creates an interrupt signal that gets triggered when interrupt_requested event arrives.
 *
 * The signal is scoped to the current Effect scope, so each operation gets its own signal.
 * Multiple concurrent operations will all respond to the same interrupt event (correct behavior).
 *
 * @param eventBus - The event bus to subscribe to for interrupt events
 * @returns A Deferred that completes when interrupt is requested
 *
 * @example
 * ```typescript
 * const signal = yield* createInterruptSignal(eventBus)
 *
 * yield* Effect.race(
 *   longRunningOperation,
 *   Deferred.await(signal)
 * )
 *
 * const wasInterrupted = yield* Deferred.isDone(signal)
 * ```
 */
export function createInterruptSignal(
  eventBus: EventBus
): Effect.Effect<Deferred.Deferred<void>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()

    // Fork a fiber to listen for interrupt events
    yield* Effect.gen(function* () {
      const interrupts = yield* eventBus.subscribe(
        (e): e is { type: 'interrupt_requested'; reason: string } =>
          e.type === 'interrupt_requested'
      )

      yield* Stream.runForEach(interrupts, () =>
        Deferred.succeed(signal, undefined)
      )
    }).pipe(Effect.forkScoped)

    return signal
  })
}

/**
 * Makes an Effect interruptible by racing it with interrupt signal.
 *
 * Returns Option:
 * - Some(result) if operation completed normally
 * - None if operation was interrupted
 *
 * @param operation - The long-running operation to make interruptible
 * @param eventBus - The event bus to subscribe to for interrupt events
 * @returns Option<A> - Some if completed, None if interrupted
 *
 * @example
 * ```typescript
 * const result = yield* makeInterruptible(
 *   Stream.runForEach(textStream, processChunk),
 *   eventBus
 * )
 *
 * if (Option.isNone(result)) {
 *   console.log('Operation was interrupted')
 *   // Emit cleanup events
 * } else {
 *   console.log('Operation completed:', result.value)
 * }
 * ```
 */
/**
 * Result of an interruptible operation
 */
export type InterruptibleResult<A, E> =
  | { _tag: 'Completed'; value: A }
  | { _tag: 'Interrupted' }
  | { _tag: 'Failed'; error: E }

export function makeInterruptible<A, E, R>(
  operation: Effect.Effect<A, E, R>,
  eventBus: EventBus
): Effect.Effect<InterruptibleResult<A, E>, never, R | Scope.Scope> {
  return Effect.gen(function* () {
    const interruptSignal = yield* createInterruptSignal(eventBus)

    // Race the operation with interrupt signal
    // Both sides return InterruptibleResult, so race always succeeds
    const result = yield* Effect.race(
      operation.pipe(
        Effect.match({
          onFailure: (error): InterruptibleResult<A, E> => ({ _tag: 'Failed', error }),
          onSuccess: (value): InterruptibleResult<A, E> => ({ _tag: 'Completed', value })
        })
      ),
      Deferred.await(interruptSignal).pipe(
        Effect.as<InterruptibleResult<A, E>>({ _tag: 'Interrupted' })
      )
    )

    return result
  })
}

// Type guards removed - use result._tag === 'Interrupted' | 'Completed' | 'Failed' directly
