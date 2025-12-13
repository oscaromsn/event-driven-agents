/**
 * Mock LLM Service for Testing
 */

import { Effect, Layer, Ref, Stream } from 'effect'
import type { BamlUsage } from '../../events.ts'
import { EventBus } from '../../services/event-bus.ts'
import { LLMService } from '../../services/llm-service.ts'

export interface MockLLMConfig {
  responses: string[]
  chunkDelayMs: number
  callCount: number
}

/**
 * Create a mock LLM service with predefined responses
 */
export function createMockLLMService(config: {
  responses: string[]
  chunkDelayMs?: number
}) {
  return Layer.scoped(
    LLMService,
    Effect.gen(function* () {
      const eventBus = yield* EventBus
      const callCountRef = yield* Ref.make(0)
      const usageRef = yield* Ref.make<BamlUsage>({ totalTokens: 0 })

      const chunkDelayMs = config.chunkDelayMs ?? 0

      // Subscribe to LLM start events
      const llmStarts = yield* eventBus.subscribe(
        (e): e is { type: 'llm_response_started'; streamId: string } =>
          e.type === 'llm_response_started'
      )

      yield* Stream.runForEach(llmStarts, (event) =>
        Effect.gen(function* () {
          const callIndex = yield* Ref.get(callCountRef)
          yield* Ref.update(callCountRef, n => n + 1)

          if (callIndex >= config.responses.length) {
            const error = new Error(
              `[MockLLM] Ran out of responses! Called ${callIndex + 1} times but only ${config.responses.length} response(s) configured.`
            )
            console.error(error.message)
            yield* eventBus.publish({
              type: 'llm_stream_interrupted',
              streamId: event.streamId
            })
            return
          }

          const response = config.responses[callIndex]
          console.log(`[MockLLM] Call #${callIndex + 1}: Streaming response:`, response.substring(0, 60) + '...')

          // Split response into word chunks to simulate streaming
          const words = response.split(' ')
          const chunks = words.map((word, i) => i === words.length - 1 ? word : word + ' ')

          // Stream chunks
          yield* Stream.runForEach(
            Stream.fromIterable(chunks),
            (chunk) => Effect.gen(function* () {
              if (chunkDelayMs > 0) {
                yield* Effect.sleep(chunkDelayMs)
              }
              yield* eventBus.publish({
                type: 'llm_text_chunk',
                streamId: event.streamId,
                text: chunk
              })
            })
          )

          // Complete
          yield* eventBus.publish({
            type: 'llm_response_completed',
            streamId: event.streamId,
            usage: { totalTokens: 0 }
          })
        })
      ).pipe(Effect.forkScoped)

      return {
        start: Effect.void,
        getUsage: Ref.get(usageRef)
      } as LLMService
    })
  )
}
