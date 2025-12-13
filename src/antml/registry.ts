/**
 * ANTML Tool Registry - Effect service for tool validation
 */

import { Context, Effect, Layer, Schema } from 'effect'
import { ParameterParseError, UnknownToolError, ValidationError } from './errors'
import type { AntmlTool, AntmlToolCollection } from './types'

/**
 * Tool registry service interface
 */
export interface AntmlToolRegistryService {
  /**
   * Get tool by name - fails with UnknownToolError if not found
   */
  readonly getToolByName: (name: string) => Effect.Effect<AntmlTool, UnknownToolError>

  /**
   * Validate parameters against tool schema
   * Returns decoded/validated data or ValidationError
   */
  readonly validateParameters: <A = unknown>(
    toolName: string,
    rawParameters: Record<string, string>
  ) => Effect.Effect<A, UnknownToolError | ValidationError | ParameterParseError>

  /**
   * Get all available tool names
   */
  readonly getAvailableTools: () => readonly string[]
}

/**
 * Service tag for dependency injection
 */
export class AntmlToolRegistry extends Context.Tag('AntmlToolRegistry')<
  AntmlToolRegistry,
  AntmlToolRegistryService
>() {}

/**
 * Parse raw string parameter value
 * Try to parse as JSON first, fallback to raw string (matches original @sagekit/antml behavior)
 */
const parseParameterValue = (value: string): Effect.Effect<unknown, ParameterParseError> =>
  Schema.decodeUnknown(Schema.parseJson())(value).pipe(
    Effect.catchAll(() => Effect.succeed(value))
  )

/**
 * Parse all raw parameters to proper types
 */
const parseParameters = (
  rawParams: Record<string, string>
): Effect.Effect<Record<string, unknown>, ParameterParseError> =>
  Effect.gen(function* () {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(rawParams)) {
      result[key] = yield* parseParameterValue(value)
    }

    return result
  })

/**
 * Create tool registry layer from tool definitions
 */
export const makeAntmlToolRegistry = <TTools extends AntmlToolCollection>(
  tools: TTools
): Layer.Layer<AntmlToolRegistry> => {
  const toolMap = new Map(tools.map(tool => [tool.name, tool]))
  const availableToolNames = tools.map(t => t.name)

  const service: AntmlToolRegistryService = {
    getToolByName: (name: string) =>
      Effect.gen(function* () {
        const tool = toolMap.get(name)
        if (!tool) {
          return yield* Effect.fail(
            new UnknownToolError({
              toolName: name,
              availableTools: availableToolNames
            })
          )
        }
        return tool
      }),

    validateParameters: <A = unknown>(
      toolName: string,
      rawParameters: Record<string, string>
    ): Effect.Effect<A, UnknownToolError | ValidationError | ParameterParseError> =>
      Effect.gen(function* () {
        // Get tool (may fail with UnknownToolError)
        const tool = toolMap.get(toolName)
        if (!tool) {
          return yield* Effect.fail(
            new UnknownToolError({
              toolName,
              availableTools: availableToolNames
            })
          )
        }

        // Parse raw string params to proper types
        const parsedParams = yield* parseParameters(rawParameters)

        // Validate with Effect Schema (synchronously, catching errors)
        const result = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(tool.schema as any)(parsedParams, { errors: 'all', onExcessProperty: 'ignore' }),
          catch: (error) => new ValidationError({
            toolName,
            issues: error instanceof Error ? [{ _tag: 'Type', message: error.message } as any] : []
          })
        })

        return result as A
      }),

    getAvailableTools: () => availableToolNames
  }

  return Layer.succeed(AntmlToolRegistry, service)
}
