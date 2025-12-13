/**
 * ANTML Parser - Incremental XML Parser with Validation
 *
 * Parses ANTML format incrementally from streaming chunks and validates
 * function calls against tool schemas.
 *
 * Format:
 * <thinking>...</thinking>
 * <function_calls>
 *   <invoke name="tool">
 *     <parameter name="param">value</parameter>
 *   </invoke>
 * </function_calls>
 */

import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { AntmlToolRegistry } from './registry'
import type { AntmlToolCollection } from './types'

/**
 * Parser service interface
 */
export interface ParserService<T> {
  parseStream: <TInput = string, TError = never, TContext = never>(
    chunks: Stream.Stream<TInput, TError, TContext>
  ) => Stream.Stream<T, TError, TContext>
}

/**
 * Parsed item wrapper
 */
export interface ParsedItem<TType extends string, TData> {
  type: TType
  data: TData
}

/**
 * Create a parser service context tag and helper
 */
const createParserService = <T>() => {
  const tag = Context.GenericTag<ParserService<T>>('ParserService')
  return tag
}

/**
 * ANTML parsed data types
 */
export type AntmlParsedType = 'text' | 'thinking' | 'function_call' | 'validation_error'

/**
 * ANTML parsed data - generic over tool collection
 */
export type AntmlParsed<TTools extends AntmlToolCollection = AntmlToolCollection> =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'function_call'
      name: TTools[number]['name']
      parameters: Schema.Schema.Type<TTools[number]['schema']>
      rawParameters: Record<string, string>
    }
  | {
      type: 'validation_error'
      name: string
      error: {
        type: 'unknown_tool' | 'invalid_parameters'
        message: string
        details?: unknown
      }
      rawParameters: Record<string, string>
    }

/**
 * ANTML parsed item - generic over tool collection
 */
export type AntmlParsedItem<TTools extends AntmlToolCollection = AntmlToolCollection> = ParsedItem<
  AntmlParsedType,
  AntmlParsed<TTools>
>

/**
 * Parser state for incremental parsing
 */
interface ParserState {
  buffer: string
  collectingFor: { tagName: string; startTag: string } | null
}

/**
 * Parse opening tag to extract tag name and attributes
 */
function parseOpeningTag(fullTag: string): { tagName: string; attributes: Record<string, string> } | null {
  // Skip closing tags, comments
  if (fullTag.startsWith('</') || fullTag.startsWith('<!--') || fullTag.startsWith('<!')) {
    return null
  }

  // Match opening tags: <tagname ...> or <tagname .../>
  const match = fullTag.match(/^<([^\s>\/]+)([^>]*?)\s*(\/?)>$/)
  if (!match) {
    return null
  }

  const [, tagName, attributesStr] = match
  const attributes: Record<string, string> = {}

  // Parse attributes if present
  if (attributesStr) {
    const attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g
    let attrMatch
    while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2] || attrMatch[3]
    }
  }

  return { tagName, attributes }
}

/**
 * Parse function calls from <function_calls> content with validation
 */
const parseFunctionCallsXml = <TTools extends AntmlToolCollection>(
  content: string
): Effect.Effect<AntmlParsedItem<TTools>[], never, AntmlToolRegistry> =>
  Effect.gen(function* () {
    const registry = yield* AntmlToolRegistry
    const results: AntmlParsedItem<TTools>[] = []

    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g
    let match

    while ((match = invokeRegex.exec(content)) !== null) {
      const [, toolName, invokeContent] = match

      // Extract parameters
      const rawParameters: Record<string, string> = {}
      const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g
      let paramMatch

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        const [, paramName, paramValue] = paramMatch
        rawParameters[paramName] = paramValue
      }

      // Validate parameters with registry
      const validated = yield* registry.validateParameters(toolName, rawParameters).pipe(
        Effect.map(
          (parameters): AntmlParsedItem<TTools> => ({
            type: 'function_call' as const,
            data: {
              type: 'function_call' as const,
              name: toolName as TTools[number]['name'],
              parameters: parameters as Schema.Schema.Type<TTools[number]['schema']>,
              rawParameters
            }
          })
        ),
        Effect.catchTag('UnknownToolError', (error): Effect.Effect<AntmlParsedItem<TTools>, never> =>
          Effect.succeed({
            type: 'validation_error' as const,
            data: {
              type: 'validation_error' as const,
              name: toolName,
              error: {
                type: 'unknown_tool' as const,
                message: `Unknown tool: ${toolName}. Available tools: ${error.availableTools.join(', ')}`
              },
              rawParameters
            }
          })
        ),
        Effect.catchTag('ValidationError', (error): Effect.Effect<AntmlParsedItem<TTools>, never> =>
          Effect.succeed({
            type: 'validation_error' as const,
            data: {
              type: 'validation_error' as const,
              name: toolName,
              error: {
                type: 'invalid_parameters' as const,
                message: `Invalid parameters for ${toolName}`,
                details: error.issues
              },
              rawParameters
            }
          })
        ),
        Effect.catchTag('ParameterParseError', (error): Effect.Effect<AntmlParsedItem<TTools>, never> =>
          Effect.succeed({
            type: 'validation_error' as const,
            data: {
              type: 'validation_error' as const,
              name: toolName,
              error: {
                type: 'invalid_parameters' as const,
                message: `Failed to parse parameter: ${error.paramName}`,
                details: error.cause
              },
              rawParameters
            }
          })
        )
      )

      results.push(validated)
    }

    return results
  })

/**
 * Process one chunk through the parser state machine
 */
const processChunk = <TTools extends AntmlToolCollection>(
  state: ParserState,
  chunk: string
): Effect.Effect<{ state: ParserState; results: AntmlParsedItem<TTools>[] }, never, AntmlToolRegistry> =>
  Effect.gen(function* () {
    state.buffer += chunk
    const results: AntmlParsedItem<TTools>[] = []

    while (state.buffer.length > 0) {
      // If collecting content for a tag (thinking or function_calls)
      if (state.collectingFor) {
        const closingTag = `</${state.collectingFor.tagName}>`
        const closeIndex = state.buffer.indexOf(closingTag)

        if (closeIndex === -1) {
          // Haven't found closing tag yet, keep buffering
          break
        }

        // Found closing tag! Extract content
        const content = state.buffer.substring(0, closeIndex)

        // Yield complete tag immediately
        if (state.collectingFor.tagName === 'thinking') {
          results.push({
            type: 'thinking',
            data: { type: 'thinking', content }
          })
        } else if (state.collectingFor.tagName === 'function_calls') {
          const calls = yield* parseFunctionCallsXml<TTools>(content)
          results.push(...calls)
        }

        state.buffer = state.buffer.substring(closeIndex + closingTag.length)
        state.collectingFor = null
        continue
      }

      // Look for opening tag
      const tagStart = state.buffer.indexOf('<')
      if (tagStart === -1) {
        if (state.buffer.length > 0) {
          results.push({
            type: 'text',
            data: { type: 'text', content: state.buffer }
          })
          state.buffer = ''
        }
        break
      }

      if (tagStart > 0) {
        results.push({
          type: 'text',
          data: { type: 'text', content: state.buffer.substring(0, tagStart) }
        })
        state.buffer = state.buffer.substring(tagStart)
      }

      const tagEnd = state.buffer.indexOf('>')
      if (tagEnd === -1) {
        // Tag not complete yet, wait for more chunks
        break
      }

      const fullTag = state.buffer.substring(0, tagEnd + 1)
      const tagInfo = parseOpeningTag(fullTag)

      if (tagInfo && (tagInfo.tagName === 'thinking' || tagInfo.tagName === 'function_calls')) {
        // Start collecting content for ANTML tags
        state.buffer = state.buffer.substring(tagEnd + 1)
        state.collectingFor = { tagName: tagInfo.tagName, startTag: fullTag }
      } else {
        // Not an ANTML tag we care about, yield as text
        results.push({
          type: 'text',
          data: { type: 'text', content: fullTag }
        })
        state.buffer = state.buffer.substring(tagEnd + 1)
      }
    }

    return { state, results }
  })

/**
 * Create ANTML Parser service - generic over tool collection
 */
export const createAntmlParser = <TTools extends AntmlToolCollection>() => {
  const AntmlParserService = createParserService<AntmlParsedItem<TTools>>()

  const makeParser = Effect.gen(function* () {
    const registry = yield* AntmlToolRegistry

    return AntmlParserService.of({
      parseStream: <TInput = string, TError = never, TContext = never>(
        chunks: Stream.Stream<TInput, TError, TContext>
      ): Stream.Stream<AntmlParsedItem<TTools>, TError, TContext> => {
        let state: ParserState = { buffer: '', collectingFor: null }

        return chunks.pipe(
          Stream.mapEffect(chunk =>
            processChunk<TTools>(state, chunk as string).pipe(
              Effect.provide(Layer.succeed(AntmlToolRegistry, registry)),
              Effect.map(({ state: newState, results }) => {
                state = newState
                return results
              })
            )
          ),
          Stream.flatMap(results => Stream.fromIterable(results))
        )
      }
    })
  })

  return {
    service: AntmlParserService,
    layer: Layer.effect(AntmlParserService, makeParser)
  }
}

// Export default non-generic version for backwards compat
const defaultParser = createAntmlParser()
export const makeAntmlParser = defaultParser.layer
export const AntmlParserLayer = defaultParser.layer
