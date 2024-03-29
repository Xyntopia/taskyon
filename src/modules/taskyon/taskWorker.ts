import {
  callLLM,
  getOpenAIAssistantResponse,
  ChatStateType,
  prepareTasksForInference,
  enrichWithDelayedUsageInfos,
  estimateChatTokens,
  generateHeaders,
  getApiConfigCopy,
} from './chat';
import { yamlToolChatType, partialTaskDraft } from './types';
import { addTask2Tree, processTasksQueue } from './taskManager';
import { tools } from './tools';
import { FunctionArguments, FunctionCall } from './types';
import type { LLMTask } from './types';
import type { OpenAI } from 'openai';
import { TaskManager } from './taskManager';
import { handleFunctionExecution } from './tools';
import { load } from 'js-yaml';
import { deepMerge } from './utils';

function isOpenAIFunctionCall(
  choice: OpenAI.ChatCompletion['choices'][0]
): boolean {
  return (
    (choice.finish_reason === 'function_call' ||
      choice.finish_reason === 'tool_calls') &&
    !!choice.message.tool_calls?.length
  );
}

function extractOpenAIFunctions(choice: OpenAI.ChatCompletion['choices'][0]) {
  const functionCalls: FunctionCall[] = [];
  for (const toolCall of choice.message.tool_calls || []) {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...');
    const name = toolCall.function.name;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let funcArguments: FunctionArguments = {};
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      funcArguments = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      // in this case, we assume, that the first parameter was meant...
      funcArguments = {};
      const toolProps = tools[name]?.parameters.properties;
      if (toolProps) {
        funcArguments[Object.keys(toolProps)[0]] = toolCall.function.arguments;
      }
    }
    const functionCall: FunctionCall = {
      name,
      arguments: funcArguments,
    };
    functionCalls.push(functionCall);
  }
  return functionCalls;
}

export async function processChatTask(
  task: LLMTask,
  chatState: ChatStateType,
  apiKeys: Record<string, string>,
  taskManager: TaskManager
) {
  let apiKey = apiKeys[chatState.selectedApi];
  if (!apiKey || apiKey.trim() === '') {
    apiKey = apiKeys['taskyon'] || '';
  }
  //TODO: merge this function with the assistants function
  if (chatState.useOpenAIAssistants && chatState.selectedApi == 'openai') {
    const messages = await getOpenAIAssistantResponse(
      task,
      apiKey,
      chatState.openAIAssistantId,
      taskManager
    );
    if (messages) {
      task.result = {
        type: 'AssistantAnswer',
        assistantResponse: messages,
      };
    }
  } else {
    const api = getApiConfigCopy(chatState, task.configuration?.chatApi);
    if (!api) {
      throw new Error(`api doesn\'t exist! ${chatState.selectedApi}`);
    }
    const selectedModel = task.configuration?.model;
    if (selectedModel) {
      api.defaultModel = selectedModel;
      console.log('execute chat task!', task);
      //TODO: also do this, if we start the task "autonomously" in which we basically
      //      allow it to create new tasks...
      //TODO: we can create more things here like giving it context form other tasks, lookup
      //      main objective, previous tasks etc....
      const useToolChat =
        task.allowedTools?.length && !chatState.enableOpenAiTools;

      const { openAIConversationThread, tools } =
        await prepareTasksForInference(
          task,
          chatState,
          (taskID) => taskManager.getTask(taskID),
          useToolChat ? 'toolchat' : 'chat'
        );

      if (openAIConversationThread.length > 0) {
        const chatCompletion = await callLLM(
          openAIConversationThread,
          tools,
          api,
          chatState.siteUrl,
          apiKey,
          // if the task runs in the "foreground", stream it :)
          task.id == chatState.selectedTaskId ? true : false,
          // this function receives chunks if we stream and senfs them into
          // our original task in the debugging property to be displayed
          // "live" (this only works if our tasks structure in task manager is
          // reactive)
          (chunk) => {
            if (chunk?.choices[0]?.delta?.tool_calls) {
              chunk?.choices[0]?.delta?.tool_calls.forEach((t) => {
                task.debugging.toolStreamArgsContent =
                  task.debugging.toolStreamArgsContent || {};
                if (t.function?.name) {
                  task.debugging.toolStreamArgsContent[t.function.name] =
                    (task.debugging.toolStreamArgsContent[t.function.name] ||
                      '') + (t.function?.arguments || '');
                }
              });
            }
            if (chunk?.choices[0]?.delta?.content) {
              task.debugging.streamContent =
                (task.debugging.streamContent || '') +
                chunk.choices[0].delta.content;
            }
          }
        );

        if (chatCompletion) {
          if ('choices' in chatCompletion) {
            const choice = chatCompletion?.choices[0];
            if (choice) {
              task.result = {
                ...task.result,
                type: useToolChat
                  ? 'ToolChatResult'
                  : isOpenAIFunctionCall(choice)
                  ? 'ToolCall'
                  : 'ChatAnswer',
                chatResponse: chatCompletion,
              };
            }
          } else {
            throw new Error(JSON.stringify(chatCompletion));
          }
        }

        if (chatCompletion && chatState.selectedApi == 'openrouter.ai') {
          void enrichWithDelayedUsageInfos(
            chatCompletion.id,
            generateHeaders(apiKey, chatState.siteUrl, chatState.selectedApi),
            task,
            taskManager
          );
        } else if (chatCompletion?.usage) {
          // openai sends back the exact number of prompt tokens :)
          task.debugging.promptTokens = chatCompletion.usage.prompt_tokens;
          task.debugging.resultTokens = chatCompletion.usage.completion_tokens;
          task.debugging.taskTokens = chatCompletion.usage.total_tokens;
        } else {
          task.debugging.estimatedTokens = estimateChatTokens(
            task,
            openAIConversationThread
          );
        }
      }
    } else {
      throw new Error('Task has no inference model selected!');
    }
  }

  return task;
}

export async function processFunctionTask(task: LLMTask) {
  if (task.configuration?.function) {
    const func = task.configuration.function;
    console.log(`Calling function ${func.name}`);
    if (tools[func.name]) {
      const result = await handleFunctionExecution(func, tools);
      task.result = result;
    } else {
      const toolnames = JSON.stringify(task.allowedTools);
      task.result = {
        type: 'ToolError',
        toolResult: {
          error: `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`,
        },
      };
    }
  }
  return task;
}

function createNewAssistantResponseTask(
  parentTask: LLMTask
): partialTaskDraft[] {
  // Process the response and create new tasks if necessary
  console.log('create new response task');
  const taskListFromResponse: partialTaskDraft[] = [];
  const messages = parentTask.result?.assistantResponse || [];
  console.log('create a new assistant response tasks...', messages);
  for (const tm of messages) {
    const allText = tm.content.filter(
      (m): m is OpenAI.Beta.Threads.MessageContentText => m.type === 'text'
    );
    taskListFromResponse.push({
      role: tm.role,
      content: allText.map((textContent) => textContent.text.value).join('\n'),
      debugging: { threadMessage: tm },
    });
  }
  return taskListFromResponse;
}

async function parseChatResponse(
  message: string,
  role: partialTaskDraft['role'] | undefined
): Promise<{ taskDraft: partialTaskDraft; execute: boolean }> {
  // parse the response and create a new task filled with the correct parameters
  let yamlContent = message.trim();
  // Use exec() to find a match
  const yamlBlockRegex = /```(yaml|YAML)\n?([\s\S]*?)\n?```/;
  const yamlMatch = yamlBlockRegex.exec(yamlContent);
  if (yamlMatch) {
    yamlContent = yamlMatch[1]; // Use the captured group
  }
  // Parse the extracted or original YAML content
  const parsedYaml = load(yamlContent);
  const toolChatResult = await yamlToolChatType.safeParseAsync(parsedYaml);
  if (toolChatResult.success) {
    console.log(toolChatResult);
    if (toolChatResult.data.toolCommand) {
      return {
        taskDraft: {
          role: 'function',
          content: null,
          configuration: {
            function: {
              name: toolChatResult.data.toolCommand.name,
              arguments: toolChatResult.data.toolCommand.args,
            },
          },
        },
        execute: true,
      };
    } else {
      return {
        taskDraft: {
          state: 'Completed',
          role: role || 'assistant',
          content:
            toolChatResult.data.answer ||
            toolChatResult.data.thought ||
            message,
        },
        execute: false,
      };
    }
  } else {
    return {
      taskDraft: {
        state: 'Completed',
        role: role || 'system',
        content: toolChatResult.error.toString(),
      },
      execute: false,
    };
  }
}

async function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  chatState: ChatStateType,
  taskManager: TaskManager
) {
  console.log('generate follow up task');
  if (finishedTask.result) {
    const taskDraftList: partialTaskDraft[] = [];
    const taskTemplate: Partial<LLMTask> = {
      configuration: {
        chatApi: finishedTask.configuration?.chatApi,
        model: finishedTask.configuration?.model,
      },
    };
    let execute = false;
    if (finishedTask.result.type === 'ChatAnswer') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      if (choice) {
        taskDraftList.push({
          state: 'Completed',
          role: choice.message.role,
          content: choice.message.content,
        });
      }
    } else if (finishedTask.result.type === 'AssistantAnswer') {
      const newTaskDraftList = createNewAssistantResponseTask(finishedTask);
      for (const td of newTaskDraftList) {
        taskDraftList.push({
          state: 'Completed',
          ...td,
        });
      }
    } else if (finishedTask.result.type === 'ToolChatResult') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      let taskDraft: partialTaskDraft | undefined = undefined;
      ({ taskDraft, execute } = await parseChatResponse(
        choice?.message.content || '',
        choice?.message.role
      ));
      if (taskDraft && execute) {
        taskDraft = deepMerge(taskTemplate, taskDraft);
      }
      if (taskDraft) {
        taskDraftList.push(taskDraft);
      }
    } else if (finishedTask.result.type === 'ToolCall') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      if (choice) {
        const functionCall = extractOpenAIFunctions(choice);
        if (functionCall) {
          taskDraftList.push(
            deepMerge(taskTemplate, {
              role: 'function',
              content: null,
              configuration: { function: functionCall[0] },
            })
          );
          execute = true;
        }
      }
    }
    let parentTaskId = finishedTask.id;
    const childCosts = {
      promptTokens: finishedTask.debugging.resultTokens,
      taskTokens: finishedTask.debugging.taskTokens,
      taskCosts: finishedTask.debugging.taskCosts,
    };
    for (const taskDraft of taskDraftList) {
      taskDraft.debugging = { ...taskDraft.debugging, ...childCosts };
      const newId = await addTask2Tree(
        taskDraft,
        parentTaskId,
        chatState,
        taskManager,
        execute
      );
      parentTaskId = newId; // create sequental task chain
    }
  }
}

const TASK_CANCELLATION_EVENT = 'cancelTasks';
export const CURRENT_TASK_CANCELLATION_EVENT = 'cancelCurrentTask';
const RUNNING_TASK_WORKER_CANCELLATION_EVENT = 'cancelRunningTaskWorker';

export function emitCancelAllTasks() {
  document.dispatchEvent(new CustomEvent(TASK_CANCELLATION_EVENT));
}

export function emitCancelTaskWorker() {
  document.dispatchEvent(
    new CustomEvent(RUNNING_TASK_WORKER_CANCELLATION_EVENT)
  );
}

export function emitCancelCurrentTask() {
  document.dispatchEvent(new CustomEvent(CURRENT_TASK_CANCELLATION_EVENT));
}

async function taskWorker(
  chatState: ChatStateType,
  taskManager: TaskManager,
  apiKeys: Record<string, string>
) {
  let cancelAllTasks = false;
  let cancelImmediately = false;
  let cancelCurrenTask = false;

  const cancelCurrentTaskListener = () => {
    cancelCurrenTask = true;
    console.log('Received signal to cancel current task');
  };

  const cancelTasksListener = () => {
    cancelAllTasks = true;
    console.log('Received signal to cancel all queued tasks');
  };

  const cancelImmediatelyListener = () => {
    cancelImmediately = true;
    console.log('Received signal for immediate cancellation');
    document.removeEventListener(
      RUNNING_TASK_WORKER_CANCELLATION_EVENT,
      cancelImmediatelyListener
    );
    throw new Error('Task Worker immediately cancelled');
  };

  document.addEventListener(
    CURRENT_TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
  document.addEventListener(TASK_CANCELLATION_EVENT, cancelTasksListener);
  document.addEventListener(
    RUNNING_TASK_WORKER_CANCELLATION_EVENT,
    cancelImmediatelyListener
  );

  window.addEventListener('beforeunload', () => {
    processTasksQueue.clear().forEach(
      (tId) =>
        void taskManager.updateTask(
          {
            id: tId,
            state: 'Cancelled',
          },
          true
        )
    );
  });

  console.log('entering task worker loop...');
  while (!cancelImmediately) {
    console.log('waiting for next task!');
    const taskId = await processTasksQueue.pop();
    if (!processTasksQueue.count()) {
      cancelAllTasks = false;
      cancelCurrenTask = false;
    } else if (cancelAllTasks) {
      void taskManager.updateTask(
        {
          id: taskId,
          state: 'Cancelled',
        },
        true
      );
      continue;
    }
    void taskManager.updateTask(
      {
        id: taskId,
        state: 'In Progress',
      },
      false
    );
    console.log('processing task:', taskId);
    let task = await taskManager.getTask(taskId);
    if (task) {
      try {
        if (task.role == 'user') {
          // TODO: get rid of "taskManager" in processChatTask
          task = await processChatTask(task, chatState, apiKeys, taskManager);
          task.state = 'Completed';
        } else if (task?.role == 'function') {
          // in the case of 'FunctionCall' result, we run it twice:
          // 1. calculate function result
          // 2. send function to LLM inference
          // the task could potentially come back as another functionCall!
          // the way this works: -> task state is "Completed" with "FunctionCall" and follow-up
          // functiontask will be generated
          if (
            task.result?.type === 'ToolResult' ||
            task.result?.type === 'ToolError'
          ) {
            // here we send the task to our LLM inference
            task = await processChatTask(task, chatState, apiKeys, taskManager);
            task.state = 'Completed';
          } else {
            // in the case we don't have a result yet, we need to calculate it :)
            task = await processFunctionTask(task);
            processTasksQueue.push(taskId); // send the task back into the queue
            task.state = 'Queued';
          }
        } else {
          console.log("We don't know what to do with this task:", taskId);
          task.state = 'Error';
        }
      } catch (error) {
        task.state = 'Error';
        if (error instanceof Error) {
          task.debugging.error = { message: error.message, stack: error.stack };
        }
        console.error('Error processing task:', error);
      }
      // if we cancelled a task we need to prevent it from creating any follow-up tasks.
      if (
        (cancelCurrenTask && task.id == chatState.selectedTaskId) ||
        cancelAllTasks
      ) {
        // current task cancellation should only be done once, so we set the flag to "false"
        cancelCurrenTask = false;
        task.state = 'Cancelled';
      } else {
        try {
          await generateFollowUpTasksFromResult(task, chatState, taskManager);
        } catch (error) {
          task.state = 'Error';
          if (error instanceof Error) {
            task.debugging.followUpError = {
              message: error.message,
              stack: error.stack,
            };
          }
          console.log('We were not able to create a follow up task:', error);
        }

        void taskManager.setTask(task, true);
      }
    }
  }

  document.removeEventListener(
    TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
  document.removeEventListener(
    CURRENT_TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
}

export function run(
  chatState: ChatStateType,
  taskManager: TaskManager,
  apiKeys: Record<string, string>
) {
  console.log('start task taskWorker');
  //launch taskworker as an asnyc worker
  void taskWorker(chatState, taskManager, apiKeys);
} // Helper function to handle function execution
