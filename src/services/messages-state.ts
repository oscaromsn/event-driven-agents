// ============================================================================
// Messages State Service (Core Truth)
// ============================================================================

import { generateId } from '../events.ts'
import { messagesReducer, type MessagesStateType } from '../reducers/messages-reducer.ts'
import { Effect, Stream, SubscriptionRef } from '../visualizer/effect-wrapper.ts'
import { EventBus } from './event-bus.ts'

export class MessagesState extends Effect.Service<MessagesState>()('MessagesState', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus

    const messagesRef = yield* SubscriptionRef.make<MessagesStateType>(
      messagesReducer.initialState,
      'MessagesState'
    )

    const events = yield* eventBus.subscribeToTypes(...messagesReducer.eventTypes)

    // Helper to trigger LLM if idle
    const triggerLLMIfIdle = Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(messagesRef)

      // Only trigger if not already streaming AND there's a user message to respond to
      if (!state.isStreaming && state.streamingMessageIndex === null) {
        const lastMessage = state.messages[state.messages.length - 1]
        if (lastMessage?.role === 'user') {
          console.log('[MessagesState] Triggering new LLM response')

          // Set lock BEFORE publishing event to prevent race condition
          yield* SubscriptionRef.update(messagesRef, s => ({
            ...s,
            isStreaming: true
          }))

          yield* eventBus.publish({
            type: 'llm_response_started',
            streamId: `stream_${generateId()}`
          })
        }
      } else if (state.isStreaming) {
        console.log('[MessagesState] Already streaming, will queue messages')
      }
    })

    yield* Stream.runForEach(events, event =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(messagesRef, state => messagesReducer.reduce(state, event))

        // Side effects after state updates
        if (event.type === 'user_message') {
          const currentState = yield* SubscriptionRef.get(messagesRef)
          if (!currentState.isStreaming) {
            yield* triggerLLMIfIdle
          }
        } else if (event.type === 'llm_response_completed') {
          const state = yield* SubscriptionRef.get(messagesRef)
          const lastMessage = state.messages[state.messages.length - 1]
          if (lastMessage?.role === 'user' && lastMessage.type === 'text') {
            yield* triggerLLMIfIdle
          }
        } else if (
          event.type === 'command_completed' ||
          event.type === 'command_failed' ||
          event.type === 'execution_rejected'
        ) {
          yield* triggerLLMIfIdle
        }
      })
    ).pipe(Effect.forkScoped)

    return {
      state: messagesRef,
      stream: messagesRef.changes
    }
  }),
  dependencies: [EventBus.Default]
}) {}
