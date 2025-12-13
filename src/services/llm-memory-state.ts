// ============================================================================
// LLM Memory State Service (Derived - Pure Function)
// ============================================================================

import { formatFunctionCalls, formatFunctionResults } from '../antml'
import type { LLMMessage } from '../events.ts'
import { Effect, Stream } from '../visualizer/effect-wrapper.ts'
import { MessagesState } from './messages-state.ts'

export class LLMMemoryState extends Effect.Service<LLMMemoryState>()('LLMMemoryState', {
  effect: Effect.gen(function* () {
    const messagesState = yield* MessagesState

    // Transform messages to LLM format
    const llmStream = messagesState.state.changes.pipe(
      Stream.map(messagesStateValue => {
        const llmMessages: LLMMessage[] = messagesStateValue.messages.map(msg => {
          switch (msg.type) {
            case 'text':
              return {
                role: msg.role,
                content: msg.content
              }
            case 'function_calls':
              return {
                role: msg.role,
                content: formatFunctionCalls(msg.calls)
              }
            case 'function_results':
              return {
                role: msg.role,
                content: formatFunctionResults(msg.results)
              }
          }
        })

        return llmMessages
      })
    )

    return {
      stream: llmStream,
      getCurrentMessages: Stream.runHead(llmStream).pipe(
        Effect.map(option => {
          if (option._tag === 'None') {
            return [] as LLMMessage[]
          }
          return option.value
        })
      )
    }
  }),
  dependencies: [MessagesState.Default]
}) {}
