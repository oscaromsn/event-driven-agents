// ============================================================================
// Minimal Flow Test - Just test user message -> LLM chunks
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { Chunk, Effect, Stream } from 'effect'
import { EventBus } from '../services/event-bus.ts'
import { LLMMemoryState } from '../services/llm-memory-state.ts'
import { LLMService } from '../services/llm-service.ts'
import { MessagesState } from '../services/messages-state.ts'
import { testLayer } from './test-utils.ts'

describe('Minimal Flow', () => {
  it('should publish LLM chunks when user sends message', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus

      // Collect all llm_text_chunk events
      const chunkStream = yield* eventBus.subscribe(
        (e): e is { type: 'llm_text_chunk'; streamId: string; text: string } =>
          e.type === 'llm_text_chunk'
      )

      // Start collecting in background - take first 5 chunks
      const collectFiber = yield* Stream.runCollect(Stream.take(chunkStream, 5)).pipe(Effect.fork)

      console.log('Publishing user_message...')

      // Publish user message
      yield* eventBus.publish({
        type: 'user_message',
        content: 'test',
        timestamp: Date.now()
      })

      // Wait for chunks to be collected
      const chunks = yield* collectFiber

      const chunksArray = Chunk.toReadonlyArray(chunks)

      console.log('Collected chunks:', chunksArray.length)
      chunksArray.forEach(c => console.log('  -', c.text))

      // Should have received chunks
      expect(chunksArray.length).toBeGreaterThan(0)

      // Verify chunks have text
      expect(chunksArray[0].text).toBeDefined()
      expect(chunksArray[0].text.length).toBeGreaterThan(0)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(testLayer(EventBus, MessagesState, LLMMemoryState, LLMService)),
        Effect.scoped
      )
    )
  }, 10000)
})
