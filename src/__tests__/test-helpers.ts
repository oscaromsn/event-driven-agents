// ============================================================================
// Test Helpers - Event-driven test utilities
// ============================================================================

import { Effect, Stream, SubscriptionRef } from 'effect'

/**
 * Wait for a state condition to be true by polling the SubscriptionRef
 * Uses the changes stream to be notified of updates, not arbitrary timeouts
 */
export function waitForCondition<T>(
  ref: SubscriptionRef.SubscriptionRef<T>,
  condition: (state: T) => boolean,
  timeoutMs: number = 1000
): Effect.Effect<T, Error> {
  return Effect.gen(function* () {
    // Check if already true
    const currentState = yield* SubscriptionRef.get(ref)
    if (condition(currentState)) {
      return currentState
    }

    // Race: wait for condition OR timeout
    const result = yield* Effect.race(
      // Wait for condition via changes stream
      ref.changes.pipe(
        Stream.filter(condition),
        Stream.take(1),
        Stream.runHead
      ).pipe(
        Effect.flatMap(opt =>
          opt._tag === 'Some'
            ? Effect.succeed(opt.value)
            : Effect.fail(new Error('Stream ended without condition'))
        )
      ),
      // Timeout
      Effect.sleep(timeoutMs).pipe(
        Effect.flatMap(() =>
          Effect.fail(new Error(`Timeout waiting for condition after ${timeoutMs}ms`))
        )
      )
    )

    return result
  })
}

/**
 * Wait for streaming to start (isStreaming === true)
 */
export function waitForStreamingStart<T extends { isStreaming: boolean }>(
  ref: SubscriptionRef.SubscriptionRef<T>
): Effect.Effect<T, Error> {
  return waitForCondition(ref, state => state.isStreaming === true)
}

/**
 * Wait for streaming to stop (isStreaming === false)
 */
export function waitForStreamingStop<T extends { isStreaming: boolean }>(
  ref: SubscriptionRef.SubscriptionRef<T>
): Effect.Effect<T, Error> {
  return waitForCondition(ref, state => state.isStreaming === false)
}

/**
 * Wait for queue to have at least N messages
 */
export function waitForQueueSize<T extends { queuedUserMessages: unknown[] }>(
  ref: SubscriptionRef.SubscriptionRef<T>,
  minSize: number
): Effect.Effect<T, Error> {
  return waitForCondition(
    ref,
    state => state.queuedUserMessages.length >= minSize
  )
}

/**
 * Wait for queue to be empty
 */
export function waitForQueueEmpty<T extends { queuedUserMessages: unknown[] }>(
  ref: SubscriptionRef.SubscriptionRef<T>
): Effect.Effect<T, Error> {
  return waitForCondition(
    ref,
    state => state.queuedUserMessages.length === 0
  )
}

/**
 * Wait for a message count condition
 */
export function waitForMessageCount<T extends { messages: unknown[] }>(
  ref: SubscriptionRef.SubscriptionRef<T>,
  minCount: number
): Effect.Effect<T, Error> {
  return waitForCondition(
    ref,
    state => state.messages.length >= minCount
  )
}

/**
 * Wait for interrupt to be pending
 */
export function waitForInterruptPending<T extends { isPending: boolean }>(
  ref: SubscriptionRef.SubscriptionRef<T>
): Effect.Effect<T, Error> {
  return waitForCondition(ref, state => state.isPending === true)
}

/**
 * Wait for interrupt to complete (not pending)
 */
export function waitForInterruptComplete<T extends { isPending: boolean }>(
  ref: SubscriptionRef.SubscriptionRef<T>
): Effect.Effect<T, Error> {
  return waitForCondition(ref, state => state.isPending === false)
}
