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
function substituteTemplateVariables(
  templates: Record<string, string>,
  variables: Record<string, string>
) {
  // TODO: can we do this as a javascript tag function? https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals
  const messages: Record<string, string> = {};

  // Iterate over each template
  for (const [templateKey, templateValue] of Object.entries(templates)) {
    let content = templateValue;

    // Replace placeholders in the template with values from variables
    for (const [variableKey, variableValue] of Object.entries(variables)) {
      content = content.replace(
        new RegExp(`{${variableKey}}`, 'g'),
        variableValue
      );
    }

    messages[templateKey] = content;
  }

  return messages;
}

export function generateOpenAIToolDeclarations(
  task: LLMTask,
  toolCollection: Record<string, ToolBase>
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

export function addPrompts(
  task: LLMTask,
  toolCollection: Record<string, ToolBase>,
  llmSettings: llmSettings,
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  method: 'toolchat' | 'chat' | 'taskAgent'
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  console.log('Prepare task tree for inference');

  let additionalMessages: OpenAI.ChatCompletionMessageParam[] = [];
  let modifiedOpenAIConversationThread = structuredClone(
    openAIConversationThread
  );

  // Check if task has tools and OpenAI tools are not enabled
  if (
    task.allowedTools?.length &&
    !llmSettings.enableOpenAiTools &&
    method === 'toolchat'
  ) {
    console.log('Creating chat task messages');

    // Prepare the variables for createTaskChatMessages
    additionalMessages = renderTaskPrompt4Chat(
      task,
      toolCollection,
      llmSettings
    );

    task.debugging.taskPrompt = additionalMessages;
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our task message
    // where we have wrapped the original message...
    modifiedOpenAIConversationThread.pop();
    // Append additional messages to the conversation thread
    modifiedOpenAIConversationThread = [
      ...modifiedOpenAIConversationThread,
      ...additionalMessages,
    ];
  } else if (llmSettings.useBasePrompt) {
    const { basePrompt } = substituteTemplateVariables(
      { basePrompt: llmSettings.taskChatTemplates.basePrompt },
      {}
    );
    const basePromptMessage: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: basePrompt,
    };
    task.debugging.taskPrompt = [basePromptMessage, ...additionalMessages];
    modifiedOpenAIConversationThread = [
      basePromptMessage,
      ...modifiedOpenAIConversationThread,
    ];
  }

  return modifiedOpenAIConversationThread;
}

export function renderTaskPrompt4Chat(
  task: Pick<LLMTask, 'role' | 'content' | 'allowedTools' | 'result'>,
  toolCollection: Record<string, ToolBase>,
  llmSettings: llmSettings
) {
  let variables = {};
  // TODO: we need to have a better way then checking the role. We need to check the content
  //       of the task.
  const toolList = task.allowedTools?.map((t) => `- ${t}`).join('\n');
  if ('message' in task.content) {
    const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolSelection);
    variables = {
      taskContent: task.content.message || '',
      schema: yamlRepr,
      format: 'yaml',
      tools: summarizeTools(task.allowedTools || [], toolCollection),
      toolList: toolList,
    };
    // TODO: to something with file tasks and
  } else if ('functionResult' in task.content) {
    const yamlRepr = zodToYamlString(
      StructuredResponseTypes.FunctionResultBase
    );
    variables = {
      toolResult: dump(task.content.functionResult),
      resultSchema: yamlRepr,
      format: 'yaml',
      tools: summarizeTools(task.allowedTools || [], toolCollection),
      toolList: toolList,
    };
  }

  // Create additional messages using createTaskChatMessages
  const filledTemplates = substituteTemplateVariables(
    llmSettings.taskChatTemplates,
    variables
  );

  // TODO: wth is going on here? this needs to be done in a better way...
  //       e.g. don't rely on task.role. we need to check the contents of the previous
  //       in order to know what we should use here. maybe just use the "method"
  const taskPrompt = (
    task.role === 'user'
      ? [filledTemplates['task']]
      : [filledTemplates['toolResult']]
  )
    .map((x) => x.trim())
    .join('\n\n');

  const toolMessage: OpenAI.ChatCompletionMessageParam = {
    role: 'user',
    content: filledTemplates['tools'],
  };

  const additionalMessages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: filledTemplates['instruction'],
    },
    toolMessage,
    {
      role: 'user',
      content: taskPrompt,
    },
  ];
  return additionalMessages;
}

export async function generateCompleteChat(
  task: LLMTask,
  llmSettings: llmSettings,
  taskManager: TyTaskManager
) {
  const useToolChat =
    task.allowedTools?.length && !llmSettings.enableOpenAiTools;

  const toolDefs = await taskManager.searchToolDefinitions();
  let openAIConversationThread = await taskManager.buildChatThread(
    task.id,
    llmSettings.tryUsingVisionModels
  );
  openAIConversationThread = addPrompts(
    task,
    toolDefs,
    llmSettings,
    openAIConversationThread,
    useToolChat ? 'toolchat' : 'chat'
  );
  return { openAIConversationThread, useToolChat, toolDefs };
}
