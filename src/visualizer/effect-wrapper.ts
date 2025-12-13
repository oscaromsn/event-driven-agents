// ============================================================================
// Effect Wrapper for Instrumentation
// ============================================================================
// Re-export Effect with instrumented versions

import { Effect, SubscriptionRef as OriginalSubscriptionRef } from 'effect'

// Store original functions
const originalUpdate = OriginalSubscriptionRef.update
const originalSet = OriginalSubscriptionRef.set
const originalMake = OriginalSubscriptionRef.make

// Global tracking
const refToServiceMap = new WeakMap<any, string>()
let eventEmitter: ((event: any) => void) | null = null

export function setStateUpdateEmitter(emitter: (event: any) => void) {
  eventEmitter = emitter
}

// Helper to tag a ref with a service name
function tagRef<A>(ref: OriginalSubscriptionRef.SubscriptionRef<A>, serviceName: string) {
  refToServiceMap.set(ref, serviceName)
  return ref
}

// Instrumented SubscriptionRef
export const SubscriptionRef = {
  ...OriginalSubscriptionRef,

  make: <A>(value: A, serviceName?: string): Effect.Effect<OriginalSubscriptionRef.SubscriptionRef<A>, never, never> => {
    return originalMake(value).pipe(
      Effect.tap((ref) => Effect.sync(() => {
        if (serviceName) {
          refToServiceMap.set(ref, serviceName)
        }
      }))
    )
  },

  set: <A>(
    self: OriginalSubscriptionRef.SubscriptionRef<A>,
    value: A
  ): Effect.Effect<void, never, never> => {
    const serviceName = refToServiceMap.get(self)

    return originalSet(self, value).pipe(
      Effect.tap(() => Effect.sync(() => {
        if (eventEmitter && serviceName) {
          eventEmitter({
            type: '__state_update__',
            source: serviceName,
            timestamp: Date.now()
          })
        }
      }))
    )
  },

  update: <A>(
    self: OriginalSubscriptionRef.SubscriptionRef<A>,
    f: (a: A) => A
  ): Effect.Effect<void, never, never> => {
    const serviceName = refToServiceMap.get(self)

    return originalUpdate(self, f).pipe(
      Effect.tap(() => Effect.sync(() => {
        if (eventEmitter && serviceName) {
          eventEmitter({
            type: '__state_update__',
            source: serviceName,
            timestamp: Date.now()
          })
        }
      }))
    )
  }
}

// Re-export everything else from effect
export * from 'effect'
