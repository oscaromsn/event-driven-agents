// ============================================================================
// POC Tools Definition
// ============================================================================

import { Schema } from 'effect'
import { defineAntmlTool } from './antml'

/**
 * Eval tool - execute TypeScript code
 */
export const evalTool = defineAntmlTool({
  name: 'eval',
  description: 'Execute TypeScript code and return the result',
  schema: Schema.Struct({
    code: Schema.String.annotations({ description: 'The TypeScript code to execute' }),
    description: Schema.optional(
      Schema.String.annotations({ description: 'Optional description of what the code does' })
    )
  })
})

/**
 * All tools for the POC
 */
export const pocTools = [evalTool] as const
