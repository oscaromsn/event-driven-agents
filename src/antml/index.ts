/**
 * Sage ANTML - Effect-native ANTML Parser with Validation
 *
 * @module @sagekit/sage-antml
 */

// Parser
export { AntmlParserLayer, createAntmlParser, makeAntmlParser } from './AntmlParser'
export type { AntmlParsed, AntmlParsedItem, AntmlParsedType, ParsedItem, ParserService } from './AntmlParser'

// Tool Registry
export { AntmlToolRegistry, makeAntmlToolRegistry } from './registry'

// Tool Types
export { defineAntmlTool } from './types'
export type { AntmlTool, AntmlToolCollection, ExtractToolNames, ExtractToolSchema } from './types'

// Formatting
export { formatFunctionCalls, formatFunctionResults } from './format'
export type { AntmlFunctionCall, AntmlFunctionResult, AntmlParameter } from './format'

// Errors
export { ParameterParseError, UnknownToolError, ValidationError } from './errors'
