/**
 * ANTML Error Types - Effect-native tagged errors
 */

import { Data, ParseResult } from 'effect'

type ParseIssue = ParseResult.ParseIssue

/**
 * Error when LLM calls an unknown tool
 */
export class UnknownToolError extends Data.TaggedError('UnknownToolError')<{
  readonly toolName: string
  readonly availableTools: readonly string[]
}> {}

/**
 * Error when tool parameters fail schema validation
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly toolName: string
  readonly issues: readonly ParseIssue[]
}> {}

/**
 * Error when a parameter cannot be parsed from string
 */
export class ParameterParseError extends Data.TaggedError('ParameterParseError')<{
  readonly paramName: string
  readonly rawValue: string
  readonly cause: unknown
}> {}
