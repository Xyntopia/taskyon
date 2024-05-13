import { ToolBase, summarizeTools } from './tools';
import { LLMTask, TaskGetter } from './types';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { zodToYamlString, StructuredResponseTypes } from './types';
import { buildChatFromTask } from './taskUtils';
import { ChatStateType, mapFunctionNames } from './chat';

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

export async function prepareTasksForInference(
  task: LLMTask,
  toolCollection: Record<string, ToolBase>,
  chatState: ChatStateType,
  getTask: TaskGetter,
  method: 'toolchat' | 'chat' | 'taskAgent'
): Promise<{
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: OpenAI.ChatCompletionTool[];
}> {
  console.log('Prepare task tree for inference');
  let openAIConversationThread = await buildChatFromTask(task.id, getTask);

  let tools: ToolBase[] = [];

  // Check if task has tools and OpenAI tools are not enabled
  if (
    task.allowedTools?.length &&
    !chatState.enableOpenAiTools &&
    method === 'toolchat'
  ) {
    console.log('Creating chat task messages');
    // Prepare the variables for createTaskChatMessages
    const additionalMessages: OpenAI.ChatCompletionMessageParam[] =
      createStructuredResponsePrompt(task, toolCollection, chatState);

    task.debugging.taskPrompt = additionalMessages;
    // Remove the last message from openAIConversationThread
    // because it will be replaced by our additional message
    openAIConversationThread.pop();
    // Append additional messages to the conversation thread
    openAIConversationThread = [
      ...openAIConversationThread,
      ...additionalMessages,
    ];
  } else {
    // TODO: add possible instructions here :) like mentioning that
    //       we can use mermaid and html/svg in our frontend markdown-it
    tools = mapFunctionNames(task.allowedTools || [], toolCollection) || [];
  }
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

  return { openAIConversationThread, tools: openAITools };
}

export function createStructuredResponsePrompt(
  task: Pick<LLMTask, 'role' | 'content' | 'allowedTools' | 'result'>,
  toolCollection: Record<string, ToolBase>,
  chatState: ChatStateType
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
  } else {
    const yamlRepr = zodToYamlString(StructuredResponseTypes.ToolResultBase);

    variables = {
      // TODO: remove this, because we only want to include prompts. This should be removed
      //       and a task created in followuptaskcreation which has the toolResult as content!
      //       in that case we still need to know what kind of prompt we need here? Is it a follow-up prompt?
      toolResult: dump({
        successfullExecution: task.result?.toolResult?.error ? 'no' : 'yes',
        ...task.result?.toolResult,
      }),
      resultSchema: yamlRepr,
      format: 'yaml',
      tools: summarizeTools(task.allowedTools || [], toolCollection),
      toolList: toolList,
    };
  }

  // Create additional messages using createTaskChatMessages
  const filledTemplates = substituteTemplateVariables(
    chatState.taskChatTemplates,
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
