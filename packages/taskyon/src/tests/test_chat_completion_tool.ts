import { getCommandFromStructuredResponse } from '../tools/chatCompletionTool'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testChooseToolPlainTextResponseDoesNotThrow = () => {
  const response = 'I cannot provide the current time.'
  const commands = getCommandFromStructuredResponse(response)

  assert(Array.isArray(commands), 'Expected command parser to return an array')
  assert(commands.length === 0, 'Expected plain text chooser response to produce no commands')

  return {
    response,
    commands,
  }
}
testChooseToolPlainTextResponseDoesNotThrow.description =
  'Plain text LLM output in ChooseTool/AnalyzeToolResult mode must not crash the structured command parser.'
