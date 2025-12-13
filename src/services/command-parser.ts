// ============================================================================
// Command Parser Service
// ============================================================================

import { createAntmlParser, makeAntmlToolRegistry } from '../antml'
import { generateId } from '../events.ts'
import { pocTools } from '../tools.ts'
import { Effect, Stream } from '../visualizer/effect-wrapper.ts'
import { EventBus } from './event-bus.ts'
import { MessagesState } from './messages-state.ts'

export class CommandParser extends Effect.Service<CommandParser>()('CommandParser', {
  scoped: Effect.gen(function* () {
    const eventBus = yield* EventBus
    const messagesState = yield* MessagesState

    // Create ANTML parser
    const toolRegistry = makeAntmlToolRegistry(pocTools)
    const { service: AntmlParserService, layer: antmlParserLayer } = createAntmlParser()

    // Use Stream.mapAccum to track streaming transitions declaratively
    // This replaces the mutable lastStreamingIndex variable
    const streamingTransitions = messagesState.stream.pipe(
      Stream.mapAccum(
        { prevStreamingIndex: null as number | null },
        (acc, state) => [
          { prevStreamingIndex: state.streamingMessageIndex },
          {
            wasStreaming: acc.prevStreamingIndex !== null,
            isStreaming: state.streamingMessageIndex !== null,
            messages: state.messages
          }
        ]
      ),
      // Only process transitions from streaming to not streaming
      Stream.filter(({ wasStreaming, isStreaming }) => wasStreaming && !isStreaming),
      // Extract the last message
      Stream.map(({ messages }) => messages[messages.length - 1]),
      // Only process assistant messages
      Stream.filter(msg => msg?.role === 'assistant' && msg.type === 'text')
    )

    yield* Stream.runForEach(
      streamingTransitions,
      (lastMessage) => Effect.gen(function* () {
        if (lastMessage.type !== 'text') return

        // Get parser
        const parser = yield* AntmlParserService

        // Parse the complete message content
        const chunkStream = Stream.make(lastMessage.content)
        const parsedStream = parser.parseStream(chunkStream)
        const parsedCollection = yield* Stream.runCollect(parsedStream)
        const parsedItems = Array.from(parsedCollection)

        // Extract function calls
        for (const item of parsedItems) {
          if (item.data.type === 'function_call' && item.data.name === 'eval') {
            const params = item.data.parameters as { code: string; description?: string }

            // Emit command requested event
            yield* eventBus.publish({
              type: 'command_requested',
              commandId: generateId(),
              command: 'eval',
              params: {
                code: params.code,
                description: params.description
              }
            })
          }
        }
      }).pipe(
        Effect.provide(antmlParserLayer),
        Effect.provide(toolRegistry),
        Effect.catchAll((error) => {
          console.error('[CommandParser] Failed to parse:', error)
          return Effect.void
        })
      )
    ).pipe(Effect.forkScoped)

    return {
      start: Effect.void
    }
  }),
  dependencies: [EventBus.Default, MessagesState.Default]
}) {}
