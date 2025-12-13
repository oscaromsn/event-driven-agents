/**
 * ANTML Tool Types - Effect-native tool definitions
 */

import { Schema } from 'effect'

/**
 * ANTML tool definition with Effect Schema
 */
export interface AntmlTool<Name extends string = string, S extends Schema.Schema.Any = Schema.Schema.Any> {
  readonly name: Name
  readonly schema: S
  readonly description?: string
}

/**
 * Collection of ANTML tools
 */
export type AntmlToolCollection = readonly AntmlTool[]

/**
 * Extract tool names from collection
 */
export type ExtractToolNames<TTools extends AntmlToolCollection> = TTools[number]['name']

/**
 * Extract tool schema by name
 */
export type ExtractToolSchema<
  TTools extends AntmlToolCollection,
  Name extends ExtractToolNames<TTools>
> = Extract<TTools[number], { name: Name }>['schema']

/**
 * Helper to define an ANTML tool with type safety
 */
export const defineAntmlTool = <Name extends string, S extends Schema.Schema.Any>(
  definition: AntmlTool<Name, S>
): AntmlTool<Name, S> => definition
