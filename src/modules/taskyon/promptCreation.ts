import { summarizeTools, mapFunctionNames } from './tools'
import { type ToolBase, FunctionCall } from './types'
import { safeYamlDump, zodToYamlString } from '../yamlUtils'
import type OpenAI from 'openai'
import { z } from 'zod'

const answer = z.string().nullish()
const yesno = z.enum(['yes', 'no']).or(z.boolean()).nullish()
type yesno = z.infer<typeof yesno>

// Convert yesno value to boolean
export const yesnoToBoolean = (value: unknown): boolean => {
  if (value === 'yes') return true
  if (value === 'no') return false
  return !!value // Handles boolean, null, undefined
}

export type Goals = 'SimpleCompletion' | 'AnalyzeError' | 'ChooseTool' | 'AnalyzeToolResult'

// this one here is important. It should be as simple as possible
// this type is used to parse & describe tool commands
// an LLM should be able to generaate this content...
export const UseToolBase = z.object({
  'use tool': yesno,
  'which tool': answer,
  command: FunctionCall.nullable()
    // right now, we don't know a good way to simultanously
    // parse robustly and describe precisely
    // we simply "normalize" all "no, {}, null" etc.. into undefined
    /*z.union([
      FunctionCall, // Accepts valid FunctionCall
      z.null(), // Accepts null
      z.object({}), // Accepts an empty object {}
      yesno, // Accepts yes/no object
    ])*/
    .optional()
    .describe(
      'If we should use a tool in the following step, provide the tool command. Otherwise do not!!',
    ),
})

const SystemResponseEvaluation = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'do you think we can solve the error?': yesno,
    'Would it help to use one of the mentioned tools to solve the issue?': yesno,
    'Should we try to correct the error': yesno,
    'try again': yesno,
  })
  .describe(
    'This is used as a short prompt for tasks in order to determine whether we should use a more detailed task prompt',
  )

const ToolResultBase = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'was the tool call successfull?': answer.or(yesno),
    'should we use a different tool?': answer.or(yesno),
    'should we use different parameters': yesno,
    'try again': yesno,
  })
  .describe('Structured answer schema for processing the result of a function call.')

const ToolSelection = z
  .object({
    'Do we have to use a tool?': yesno,
    'describe your thoughts': answer,
  })
  .describe('Structured answer schema for a task including the use of tools')

export const StructuredResponseTypes = {
  ToolResultBase,
  ToolSelection,
  SystemResponseEvaluation,
}
export const StructuredResponse = ToolResultBase.partial()
  .merge(ToolSelection.partial())
  .merge(SystemResponseEvaluation.partial())
  .merge(UseToolBase.partial())
export type StructuredResponse = z.infer<typeof StructuredResponse>

function substituteStringVariables(variables: Record<string, string>, content: string) {
  return Object.entries(variables).reduce(
    (acc, [variableKey, variableValue]) =>
      acc.replace(new RegExp(`{${variableKey}}`, 'g'), variableValue),
    content,
  )
}

export function generateOpenAIToolDeclarations(
  allowedTools: string[],
  toolCollection: Record<string, ToolBase>,
): OpenAI.ChatCompletionTool[] {
  const tools: ToolBase[] = mapFunctionNames(allowedTools || [], toolCollection) || []
  const openAITools: OpenAI.ChatCompletionTool[] = tools.map((t) => {
    const functionDef: OpenAI.FunctionDefinition = {
      name: t.name,
      parameters: t.parameters as unknown as Record<string, unknown>,
      description: t.description,
    }
    return {
      function: functionDef,
      type: 'function',
    }
  })
  return openAITools
}

// gets all the function calls in an openai conversation and makes a list from that :)
function getAllFunctionsInOpenAiConversation(
  modifiedOpenAIConversationThread: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[],
) {
  return modifiedOpenAIConversationThread.reduce(
    (p, c) =>
      typeof c.content === 'string'
        ? c.role === 'function'
          ? p.add(c.name)
          : c.role === 'tool'
            ? p.add(c.tool_call_id)
            : p
        : p,
    new Set<string>(),
  )
}

const string2OpenAiMessage =
  (variables: Record<string, string>) => (role: string) => (msgList: string[]) =>
    msgList.map(
      (prompt) =>
        ({
          role,
          content: substituteStringVariables(variables, prompt),
        }) as OpenAI.ChatCompletionMessageParam,
    )

export function calculateCompletionVariables(
  allowedTools: string[],
  useToolChat: boolean,
  lastMessage: unknown,
  goal: string | undefined,
  toolCollection: Record<string, ToolBase>,
) {
  const originalMessage = typeof lastMessage !== 'string' ? safeYamlDump(lastMessage) : lastMessage

  const requiredSchema =
    goal === 'AnalyzeError'
      ? useToolChat
        ? StructuredResponseTypes.SystemResponseEvaluation.merge(UseToolBase)
        : StructuredResponseTypes.SystemResponseEvaluation
      : goal === 'ChooseTool'
        ? StructuredResponseTypes.ToolSelection.merge(UseToolBase)
        : goal === 'AnalyzeToolResult'
          ? useToolChat
            ? StructuredResponseTypes.ToolResultBase.merge(UseToolBase)
            : StructuredResponseTypes.ToolResultBase
          : undefined

  const variables = {
    format: 'yaml',
    message: originalMessage,
    schema: requiredSchema ? zodToYamlString(requiredSchema) : '<No schema specified>',
    tools: summarizeTools(allowedTools || [], toolCollection),
  }
  return variables
}

// enhance the chat by inserting prompts before certain message which
// make them better to understand for the AI...
export function addPrompts(
  toolCollection: Record<string, ToolBase>,
  options: {
    enableOpenAiTools: boolean
    useBasePrompt: boolean
    taskChatTemplates: {
      basePrompt: string
      evaluate: string
      instruction: string
      tools: string
      task: string
      schemaReminder: string
      toolResult: string
    }
  },
  variables: {
    format: string
    message: string
    schema: string
    tools: string
  },
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  prompts: string[],
  goal?: Goals,
) {
  // Check if task has tools and OpenAI tools are not enabled
  //console.log('Creating chat prompts');

  const modifiedOpenAIConversationThread = structuredClone(openAIConversationThread)
  const prependMessagesList: string[] = []
  const appendMessagesList: string[] = []
  const appendSystemMessage: string[] = []

  // we always prepend our "fancy" prompt, if we use "native" tools...
  if ((goal === 'SimpleCompletion' && options.useBasePrompt) || options.enableOpenAiTools) {
    prependMessagesList.unshift(options.taskChatTemplates.basePrompt)

    if (!options.enableOpenAiTools) {
      const calledFunctions = getAllFunctionsInOpenAiConversation(modifiedOpenAIConversationThread)
      // if any tools appeared during the conversation...
      if (calledFunctions.size > 0) {
        // this one is used, if we don't need to choose a tool, but it is necessary for the AI to know that a result
        // that it has access to was calculated by a tool.
        const functionCallDescription = summarizeTools([...calledFunctions], toolCollection, true)
        const toolAwareness = `You have access to and used the following tools: \n\n ${functionCallDescription}`

        prependMessagesList.push(toolAwareness)
      }
    }
  }
  if (goal && goal !== 'SimpleCompletion') {
    // only add tools, if we don#t use the native API already
    if (!options.enableOpenAiTools) {
      appendMessagesList.push(
        options.taskChatTemplates.instruction,
        options.taskChatTemplates.tools,
      )
      // send instructions only if there aren't any custom prompts...
      if (prompts.length === 0) {
        // Remove the last message from openAIConversationThread
        // because it will be replaced by our task/evaluate/toolResult messages
        // where we have wrapped the original message...
        modifiedOpenAIConversationThread.pop()
        if (goal === 'AnalyzeError') {
          appendMessagesList.push(options.taskChatTemplates.evaluate)
        } else if (goal === 'ChooseTool') {
          appendMessagesList.push(options.taskChatTemplates.task)
        } else if (goal === 'AnalyzeToolResult') {
          appendMessagesList.push(options.taskChatTemplates.toolResult)
        }
      }
    }
    // put custom prompts between general instruction, tool lists and
    // the schema enforcer
    appendMessagesList.push(...prompts)
    if (!options.enableOpenAiTools)
      appendSystemMessage.push(options.taskChatTemplates.schemaReminder)
  } else {
    appendMessagesList.push(...prompts)
  }

  const converter = string2OpenAiMessage(variables)

  const prependMessages = converter('system')(prependMessagesList)
  const appendMessages = converter('user')(appendMessagesList)
  appendMessages.push(...converter('system')(appendSystemMessage))

  // build our complete thread :)
  return { prependMessages, modifiedOpenAIConversationThread, appendMessages }
}
