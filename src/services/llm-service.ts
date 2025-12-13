// ============================================================================
// LLM Service - Handles LLM streaming via BAML + EventBus integration
// ============================================================================

import { Collector } from '@boundaryml/baml'
import { b, type ChatMessage } from '../baml_client'
import type { BamlUsage } from '../events.ts'
import { makeInterruptible } from '../utils/interruptible.ts'
import { Effect, Ref, Stream } from '../visualizer/effect-wrapper.ts'
import { EventBus } from './event-bus.ts'
import { LLMMemoryState } from './llm-memory-state.ts'

export class LLMService extends Effect.Service<LLMService>()('LLMService', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus
    const llmMemoryState = yield* LLMMemoryState
    const collector = new Collector('LLMService')
    const usageRef = yield* Ref.make<BamlUsage>({ totalTokens: 0 })

    // Subscribe to LLM start events
    const llmStarts = yield* eventBus.subscribe(
      (e): e is { type: 'llm_response_started'; streamId: string } =>
        e.type === 'llm_response_started'
    )

    yield* Stream.runForEach(llmStarts, (event) =>
      Effect.gen(function* () {
        console.log('[LLMService] Starting stream:', event.streamId)

        // Get current LLM-formatted messages
        const llmMessages = yield* llmMemoryState.getCurrentMessages
        console.log('[LLMService] Got messages:', llmMessages.length)

        // Convert to BAML format
        const bamlMessages: ChatMessage[] = llmMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))

        const bamlStream = b.stream.Chat(bamlMessages, { collector })

        // Convert async iterable to Effect Stream
        const contentStream = Stream.fromAsyncIterable(
          bamlStream,
          (error) => error as Error
        )

        // Use Ref to track accumulated text
        const accumulatedRef = yield* Ref.make('')

        const incrementalStream = contentStream.pipe(
          Stream.scan(
            { previous: '', accumulated: '', current: '' },
            (state, currentContent) => ({
              previous: currentContent,
              accumulated: currentContent,
              current: currentContent.slice(state.previous.length)
            })
          ),
          Stream.filter(({ current }) => current.length > 0),
          Stream.tap(({ accumulated }) =>
            Ref.set(accumulatedRef, accumulated)
          )
        )

        // Make stream processing interruptible
        const result = yield* makeInterruptible(
          Stream.runForEach(
            incrementalStream,
            ({ current }) => {
              console.log('[LLMService] Text chunk:', current.slice(0, 20))
              return eventBus.publish({
                type: 'llm_text_chunk',
                streamId: event.streamId,
                text: current
              })
            }
          ),
          eventBus
        )

        // Extract usage
        const lastCall = collector.last?.calls.at(-1)
        if (lastCall?.httpResponse) {
          try {
            const body = lastCall.httpResponse.body.json()
            const usage = body.usage
            if (usage) {
              yield* Ref.set(usageRef, { totalTokens: usage.input_tokens + usage.output_tokens })
            }
            console.log('[LLMService] Stop reason:', body.stop_reason)
          } catch {
            yield* Ref.set(usageRef, {
              totalTokens: (collector.usage.inputTokens ?? 0) + (collector.usage.outputTokens ?? 0)
            })
          }
        }

        const currentUsage = yield* Ref.get(usageRef)

        // Handle result
        if (result._tag === 'Failed') {
          console.log('[LLMService] Stream failed:', result.error)
          yield* eventBus.publish({
            type: 'llm_stream_interrupted',
            streamId: event.streamId
          })
        } else if (result._tag === 'Interrupted') {
          console.log('[LLMService] Stream was interrupted')
          yield* eventBus.publish({
            type: 'llm_stream_interrupted',
            streamId: event.streamId
          })
          yield* eventBus.publish({
            type: 'llm_response_completed',
            streamId: event.streamId,
            usage: currentUsage
          })
          yield* eventBus.publish({
            type: 'interrupt_cleanup_completed'
          })
        } else {
          console.log('[LLMService] Stream completed normally')

          // Check if we need to add synthetic closing tag
          const finalAccumulated = yield* Ref.get(accumulatedRef)
          const needsClosingTag = (text: string) => {
            const trimmed = text.trimEnd()
            if (!trimmed.endsWith('</invoke>')) return false
            const openCount = (trimmed.match(/<function_calls>/g) || []).length
            const closeCount = (trimmed.match(/<\/function_calls>/g) || []).length
            return openCount > closeCount
          }

          if (needsClosingTag(finalAccumulated)) {
            console.log('[LLMService] Adding synthetic </function_calls> closing tag')
            yield* eventBus.publish({
              type: 'llm_text_chunk',
              streamId: event.streamId,
              text: '</function_calls>'
            })
          }

          yield* eventBus.publish({
            type: 'llm_response_completed',
            streamId: event.streamId,
            usage: currentUsage
          })
        }
      }).pipe(
        Effect.catchAll((error) => {
          console.log('[LLMService] ERROR:', error)
          return eventBus.publish({
            type: 'llm_stream_interrupted',
            streamId: event.streamId
          })
        })
      )
    ).pipe(Effect.forkScoped)

    return {
      start: Effect.void,
      getUsage: Ref.get(usageRef)
    }
  }),
  dependencies: [EventBus.Default, LLMMemoryState.Default]
}) {}
