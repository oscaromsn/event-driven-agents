/**
 * Mock LLM Response Utilities
 */

export const mockResponses = {
  /**
   * eval command with ANTML
   * Parameters can be either JSON or raw strings (parser tries JSON first, falls back to raw)
   */
  eval(code: string, description?: string): string {
    const descParam = description
      ? `<parameter name="description">${description}</parameter>`
      : ''

    return (
      `<function_calls><invoke name="eval">` +
      `<parameter name="code">${code}</parameter>` +
      descParam +
      `</invoke></function_calls>`
    )
  },

  /**
   * Text response with embedded eval call
   */
  textWithEval(textBefore: string, code: string, description?: string, textAfter?: string): string {
    return `${textBefore}${mockResponses.eval(code, description)}${textAfter || ''}`
  },

  /**
   * Simple text response (no commands)
   */
  text(content: string): string {
    return content
  }
}
