import { summarizeTools } from './tools';
import {
  ToolBase,
  LLMTask,
  llmSettings,
  StructuredResponseTypes,
} from './types';
import { zodToYamlString } from './openapi';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { mapFunctionNames } from './chat';
import type { TyTaskManager } from './taskManager';

/**
 * This function renders templates, substituting the necessary variables
 *
 */
function substituteTemplateVariables<T extends Record<string, string>>(
  templates: T,
  variables: Record<string, string>,
): { [K in keyof T]: string } {
  // TODO: can we do this as a javascript tag function? https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals
  const messages: Record<keyof T, string> = {} as Record<keyof T, string>;

  // Iterate over each template
  for (const [templateKey, templateValue] of Object.entries(templates)) {
    let content = templateValue;

    // Replace placeholders in the template with values from variables
    for (const [variableKey, variableValue] of Object.entries(variables)) {
      content = content.replace(
        new RegExp(`{${variableKey}}`, 'g'),
        variableValue,
      );
    }

    messages[templateKey as keyof T] = content;
  }

  return messages;
}

export function generateOpenAIToolDeclarations(
  task: LLMTask,
  toolCollection: Record<string, ToolBase>,
): OpenAI.ChatCompletionTool[] {
  const tools: ToolBase[] =
    mapFunctionNames(task.allowedTools || [], toolCollection) || [];
  const openAITools: OpenAI.ChatCompletionTool[] = tools.map((t) => {
    const functionDef: OpenAI.FunctionDefinition = {
      name: t.name,
      parameters: t.parameters as unknown as Record<string, unknown>,
      description: t.description,
    };
    return {
      function: functionDef,
      type: 'function',
    };
  });
  return openAITools;
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
export function addPrompts(
  task: Pick<
    LLMTask,
    'role' | 'content' | 'allowedTools' | 'result' | 'debugging'
  >,
  toolCollection: Record<string, ToolBase>,
  llmSettings: llmSettings,
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  // Check if task has tools and OpenAI tools are not enabled
  console.log('Creating chat prompts');

  const useToolChat =
    task.allowedTools?.length && !llmSettings.enableOpenAiTools;

  const modifiedOpenAIConversationThread = structuredClone(
    openAIConversationThread,
  );
  const prependMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    [];
  const appendMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    [];

  const toolList = task.allowedTools?.map((t) => `- ${t}`).join('\n');
  const variables: Record<string, string> = {
    format: 'yaml',
    tools: summarizeTools(task.allowedTools || [], toolCollection),
    toolList: toolList || 'N/A',
  };

  function getTemplates() {
    const filledTemplates = substituteTemplateVariables(
      llmSettings.taskChatTemplates,
      variables,
    );
    return filledTemplates;
  }

  let structuredResponseExpected = false;
  if ('message' in task.content && task.role === 'system') {
    // this is most likely an error message or similar
    // and we need a structured response in order to decide how to
    // continue...
    const yamlRepr = zodToYamlString(
      StructuredResponseTypes.SystemResponseEvaluation,
    );
    variables.message = task.content.message;
    variables.schema = yamlRepr;
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop();

    const filledTemplates = getTemplates();
    appendMessages.push({
      role: 'user',
      content: filledTemplates.evaluate,
    });
    structuredResponseExpected = true;
  } else if ('message' in task.content && task.role === 'user' && useToolChat) {
    const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolSelection);
    variables.taskContent = task.content.message;
    variables.schema = yamlRepr;
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop();

    const filledTemplates = getTemplates();
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
    );
    structuredResponseExpected = true;
    // TODO: to something with file tasks and
  } else if ('toolResult' in task.content) {
    const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolResultBase);
    variables.toolResult = dump(task.content.toolResult);
    variables.resultSchema = yamlRepr;

    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop();

    const filledTemplates = getTemplates();
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
    );
    structuredResponseExpected = true;
    //appendMessages.push()
  }

  if (llmSettings.useBasePrompt && !structuredResponseExpected) {
    const filledTemplates = getTemplates();
    prependMessages.push({
      role: 'system',
      content: filledTemplates.basePrompt,
    });
  }

  task.debugging.taskPrompt = [...prependMessages, ...appendMessages];

  // build our complete thread :)
  return [
    ...prependMessages,
    ...modifiedOpenAIConversationThread,
    ...appendMessages,
  ];
}

export async function generateCompleteChat(
  task: LLMTask,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
) {
  const toolDefs = await taskManager.searchToolDefinitions();
  let openAIConversationThread = await taskManager.buildChatThread(
    task.id,
    llmSettings.tryUsingVisionModels,
  );
  openAIConversationThread = addPrompts(
    task,
    toolDefs,
    llmSettings,
    openAIConversationThread,
  );
  return { openAIConversationThread, toolDefs };
}
