import { summarizeTools, mapFunctionNames } from './tools'
import type { ToolBase, TaskNode, llmSettings } from './types'
import { StructuredResponseTypes, UseToolBase } from './types'
import { zodToYamlString } from '../yamlUtils'
import type OpenAI from 'openai'
import { dump } from 'js-yaml'

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

// TODO: move most of the functionality of this function into
//       taskUtils. We need to put this directly into our chat creation method.
// enhance the chat by inserting prompts before certain message which
// make them better to understand for the AI...
export function addPrompts(
  task: Pick<TaskNode, 'role' | 'content' | 'debugging'>,
  toolCollection: Record<string, ToolBase>,
  llmSettings: llmSettings,
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): tyChatCompletionmessageParam[] {
  // Check if task has tools and OpenAI tools are not enabled
  //console.log('Creating chat prompts');

  const useToolChat = llmSettings.allowedTools?.length && !llmSettings.enableOpenAiTools

  const modifiedOpenAIConversationThread = structuredClone(openAIConversationThread)
  const prependMessages: tyChatCompletionmessageParam[] = []
  const appendMessages: tyChatCompletionmessageParam[] = []

  const toolList = llmSettings.allowedTools?.map((t) => `- ${t}`).join('\n')
  const variables: Record<string, string> = {
    format: 'yaml',
    tools: summarizeTools(llmSettings.allowedTools || [], toolCollection),
    toolList: toolList || 'N/A',
  }

  function getTemplates() {
    const filledTemplates = substituteTemplateVariables(llmSettings.taskChatTemplates, variables)
    return filledTemplates
  }

  let structuredResponseExpected = false
  if ('message' in task.content && task.role === 'system') {
    // this is most likely an error message or similar
    // and we need a structured response in order to decide how to
    // continue...
    const requiredSchema = useToolChat
      ? StructuredResponseTypes.SystemResponseEvaluation.merge(UseToolBase)
      : StructuredResponseTypes.SystemResponseEvaluation
    const yamlRepr = zodToYamlString(requiredSchema)
    variables.message = task.content.message
    variables.schema = yamlRepr
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop()

    const filledTemplates = getTemplates()
    appendMessages.push({
      role: 'user',
      content: filledTemplates.evaluate,
    })
    structuredResponseExpected = true
  } else if ('message' in task.content && task.role === 'user' && useToolChat) {
    const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolSelection.merge(UseToolBase))
    variables.taskContent = task.content.message
    variables.schema = yamlRepr
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop()

    const filledTemplates = getTemplates()
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
    structuredResponseExpected = true
    // TODO: to something with file tasks and
  } else if ('toolResult' in task.content && !llmSettings.enableOpenAiTools) {
    const requiredSchema = useToolChat
      ? StructuredResponseTypes.ToolResultBase.merge(UseToolBase)
      : StructuredResponseTypes.ToolResultBase
    const yamlRepr = zodToYamlString(requiredSchema)
    variables.toolResult = dump(task.content.toolResult)
    variables.resultSchema = yamlRepr

    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop()

    const filledTemplates = getTemplates()
    appendMessages.push(
      {
        role: 'system',
        content: filledTemplates.instruction,
      },
      {
        role: 'system',
        content: filledTemplates.tools,
      },
      {
        role: 'user',
        content: filledTemplates.toolResult,
      },
    )
    structuredResponseExpected = true
    //appendMessages.push()
  } else if ('message' in task.content && task.role === 'assistant') {
    // this here gets called, if we have a structured message which was generated
    // as the "assistant" role. In the case that we are not in an agent loop or
    // want tools to be run. we simply want a response from the AI. we will
    // ask it to do that from a user perspective.  Many llms will give us
    // "null" content otherwise.
    appendMessages.push({
      role: 'user',
      content: 'Can you please make a final comment on your previous evaluation?',
    })
  }

  if (llmSettings.useBasePrompt && !structuredResponseExpected) {
    const filledTemplates = getTemplates()
    prependMessages.unshift({
      role: 'system',
      content: filledTemplates.basePrompt,
    })

    if (!llmSettings.enableOpenAiTools) {
      const calledFunctions = getAllFunctionsInOpenAiConversation(modifiedOpenAIConversationThread)
      // if any tools appeared during the conversation...
      if (calledFunctions.size > 0) {
        // this one is used, if we don't need to choose one, but it is necessary for the AI to know that a result in
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

  task.debugging.taskPrompt = [...prependMessages, ...appendMessages]

  // build our complete thread :)
  return [...prependMessages, ...modifiedOpenAIConversationThread, ...appendMessages]
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
