/**
 * ANTML Formatting Utilities
 *
 * Reconstruct ANTML XML strings for function calls and results
 */

export interface AntmlParameter {
  name: string
  value: string
}

export interface AntmlFunctionCall {
  name: string
  parameters: AntmlParameter[]
}

/**
 * ANTML function result
 */
export type AntmlFunctionResult =
  | { name: string; success: true; output: string }
  | { name: string; success: false; error: string }

/**
 * Format function calls into ANTML XML
 *
 * @example
 * formatFunctionCalls([{
 *   name: 'describe_tools',
 *   parameters: [{ name: 'tools', value: '["gmail.listEmails"]' }]
 * }])
 * // Returns:
 * // <function_calls>
 * // <invoke name="describe_tools">
 * // <parameter name="tools">["gmail.listEmails"]</parameter>
 * // </invoke>
 * // </function_calls>
 */
export function formatFunctionCalls(calls: AntmlFunctionCall[]): string {
  const invokes = calls.map(call => {
    const params = call.parameters.map(p =>
      `<parameter name="${p.name}">${p.value}</parameter>`
    ).join('\n')

    return `<invoke name="${call.name}">\n${params}\n</invoke>`
  }).join('\n')

  return `<function_calls>\n${invokes}\n</function_calls>`
}

/**
 * Format function results into ANTML XML
 *
 * @example
 * formatFunctionResults([{
 *   name: 'describe_tools',
 *   output: 'Tool description here'
 * }])
 * // Returns:
 * // <function_results>
 * // <result>
 * // <name>describe_tools</name>
 * // <output>Tool description here</output>
 * // </result>
 * // </function_results>
 */
export function formatFunctionResults(results: AntmlFunctionResult[]): string {
  const resultTags = results.map(result => {
    const content = result.success
      ? `<output>${result.output}</output>`
      : `<error>${result.error}</error>`

    return `<result>\n<name>${result.name}</name>\n${content}\n</result>`
  }).join('\n')

  return `<function_results>\n${resultTags}\n</function_results>`
}
