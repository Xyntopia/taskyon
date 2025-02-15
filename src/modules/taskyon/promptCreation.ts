import { summarizeTools, mapFunctionNames } from './tools'
import { type ToolBase, type TaskNode, type llmSettings, FunctionCall } from './types'
import { zodToYamlString } from '../yamlUtils'
import type OpenAI from 'openai'
import { dump } from 'js-yaml'
import type { Goals } from '../tools/chatCompletionTool'
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

/**
 * This function renders templates, substituting the necessary variables
 *
 */
function substituteTemplateVariables<T extends Record<string, string>>(
  templates: T,
  variables: Record<string, string>,
): { [K in keyof T]: string } {
  // TODO: can we do this as a javascript tag function? https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals
  const messages: Record<keyof T, string> = {} as Record<keyof T, string>

  // Iterate over each template
  for (const [templateKey, templateValue] of Object.entries(templates)) {
    let content = templateValue

    // Replace placeholders in the template with values from variables
    for (const [variableKey, variableValue] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{${variableKey}}`, 'g'), variableValue)
    }

    messages[templateKey as keyof T] = content
  }

  return messages
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

/**
 * This function adds several prompts to our AI conversation
 * in order to provide answers with a specific schema!
 *
 * We need to take care of the currently 3 cases where a structured response is required:
 *
 * - Tool Result
 * - Tool Selection
 * - Evaluation of System Response
 *
 * Additionally, we can optionally add generic base prompts which
 * let the AI behave in a certain way..
 *
 *
 * @param task
 * @param toolCollection
 * @param llmSettings
 * @param openAIConversationThread
 * @param method
 * @returns
 */

type tyChatCompletionmessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

// TODO: refactor this method and split it up into several functions for each goal...
//       or even better:  generalize it with the variables and specifying the prompts...
// TODO: move most of the functionality of this function into
//       chatCompletion. We need to put this directly into our chat creation method.
// enhance the chat by inserting prompts before certain message which
// make them better to understand for the AI...
export function addPrompts(
  lastTaskBeforeChatCompletion: TaskNode,
  toolCollection: Record<string, ToolBase>,
  llmSettings: llmSettings,
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  allowedTools: string[],
  goal: Goals,
) {
  // Check if task has tools and OpenAI tools are not enabled
  //console.log('Creating chat prompts');

  const useToolChat = allowedTools.length && !llmSettings.enableOpenAiTools

  const modifiedOpenAIConversationThread = structuredClone(openAIConversationThread)
  const prependMessages: tyChatCompletionmessageParam[] = []
  const appendMessages: tyChatCompletionmessageParam[] = []

  const toolList = allowedTools.map((t) => `- ${t}`).join('\n')
  const variables: Record<string, string> = {
    format: 'yaml',
    tools: summarizeTools(allowedTools || [], toolCollection),
    toolList: toolList || 'N/A',
  }

  // we always prepend our "fancy" prompt, if we use "native" tools...
  if ((goal === 'SimpleCompletion' && llmSettings.useBasePrompt) || llmSettings.enableOpenAiTools) {
    const filledTemplates = substituteTemplateVariables(llmSettings.taskChatTemplates, variables)
    prependMessages.unshift({
      role: 'system',
      content: filledTemplates.basePrompt,
    })

    if (!llmSettings.enableOpenAiTools) {
      const calledFunctions = getAllFunctionsInOpenAiConversation(modifiedOpenAIConversationThread)
      // if any tools appeared during the conversation...
      if (calledFunctions.size > 0) {
        // this one is used, if we don't need to choose a tool, but it is necessary for the AI to know that a result
        // that it has access to was calculated by a tool.
        const functionCallDescription = summarizeTools([...calledFunctions], toolCollection, true)
        const toolAwareness = `You have access to and used the following tools: \n\n ${functionCallDescription}`

        prependMessages.push({
          role: 'system',
          content: toolAwareness,
        })
      }
    }
  }

  if (!llmSettings.enableOpenAiTools) {
    if (goal === 'AnalyzeError') {
      // this is most likely an error message or similar
      // and we need a structured response in order to decide how to
      // continue...
      const requiredSchema = useToolChat
        ? StructuredResponseTypes.SystemResponseEvaluation.merge(UseToolBase)
        : StructuredResponseTypes.SystemResponseEvaluation
      const yamlRepr = zodToYamlString(requiredSchema)
      if (lastTaskBeforeChatCompletion.content.type !== 'error')
        throw new Error('Task needs to have a message!')
      // Remove the last message from openAIConversationThread
      // because it will be replaced by our task message
      // where we have wrapped the original message...
      modifiedOpenAIConversationThread.pop()

      const filledTemplates = substituteTemplateVariables(llmSettings.taskChatTemplates, {
        ...variables,
        message: lastTaskBeforeChatCompletion.content.data,
        schema: yamlRepr,
      })
      appendMessages.push({
        role: 'user',
        content: filledTemplates.evaluate,
      })
    } else if (goal === 'ChooseTool') {
      const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolSelection.merge(UseToolBase))
      if (lastTaskBeforeChatCompletion.content.type !== 'message')
        throw new Error('Task needs to have a message!')
      // Remove the last message from openAIConversationThread
      // because it will be replaced by our task message
      // where we have wrapped the original message...
      modifiedOpenAIConversationThread.pop()

      const filledTemplates = substituteTemplateVariables(llmSettings.taskChatTemplates, {
        ...variables,
        taskContent: lastTaskBeforeChatCompletion.content.data,
        schema: yamlRepr,
      })
      appendMessages.push(
        {
          role: 'user',
          content: filledTemplates.instruction,
        },
        {
          role: 'user',
          content: filledTemplates.tools,
        },
        {
          role: 'user',
          content: filledTemplates.task,
        },
      )
      // TODO: to something with file tasks and
    } else if (goal === 'AnalyzeToolResult') {
      const requiredSchema = useToolChat
        ? StructuredResponseTypes.ToolResultBase.merge(UseToolBase)
        : StructuredResponseTypes.ToolResultBase
      const yamlRepr = zodToYamlString(requiredSchema)
      if (lastTaskBeforeChatCompletion.content.type !== 'toolresult')
        throw new Error('Task needs to have a toolResult!')
      // Remove the last message from openAIConversationThread
      // because it will be replaced by our task message
      // where we have wrapped the original message...
      modifiedOpenAIConversationThread.pop()

      const filledTemplates = substituteTemplateVariables(llmSettings.taskChatTemplates, {
        ...variables,
        toolResult: dump(lastTaskBeforeChatCompletion.content.data),
        resultSchema: yamlRepr,
      })
      appendMessages.push(
        {
          role: 'user',
          content: filledTemplates.instruction,
        },
        {
          role: 'user',
          content: filledTemplates.tools,
        },
        {
          role: 'user',
          content: filledTemplates.toolResult,
        },
      )
      //appendMessages.push()
      /*} else if ('message' in task.content && task.role === 'assistant') {
    // this here gets called, if we have a structured message which was generated
    // as the "assistant" role. In the case that we are not in an agent loop or
    // want tools to be run. we simply want a response from the AI. we will
    // ask it to do that from a user perspective.  Many llms will give us
    // "null" content otherwise.
    appendMessages.push({
      role: 'user',
      content: 'Can you please make a final comment on your previous evaluation?',
    })
  }*/
    }
  }

  // build our complete thread :)
  return { prependMessages, modifiedOpenAIConversationThread, appendMessages }
}

function getAllFunctionsInOpenAiConversation(
  modifiedOpenAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
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
