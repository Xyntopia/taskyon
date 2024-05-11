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
import {
  FunctionArguments,
  FunctionCall,
  yamlToolChatType,
  partialTaskDraft,
  toolResultChat,
  LLMTask,
  TaskResult,
} from './types';
import { addTask2Tree, processTasksQueue } from './taskManager';
import type { OpenAI } from 'openai';
import { TyTaskManager } from './taskManager';
import { Tool, ToolBase, handleFunctionExecution } from './tools';
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

function extractOpenAIFunctions(
  choice: OpenAI.ChatCompletion['choices'][0],
  tools: Record<string, ToolBase>
) {
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

// this function processes all tasks which go to any sort of an LLM
export async function processChatTask(
  task: LLMTask,
  chatState: ChatStateType,
  apiKeys: Record<string, string>,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController
) {
  // TODO: refactor this function!
  let apiKey = apiKeys[chatState.selectedApi];
  if (!apiKey || apiKey.trim() === '') {
    apiKey = apiKeys['taskyon'] || 'free';
  }
  // TODO: can we interrupt non-streaming tasks? possibly using an AbortController.
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
          await taskManager.searchToolDefinitions(),
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
          },
          () => {
            return taskWorkerController.isInterrupted();
          } // define a function to check whether we should cancel the stream ...
        );

        // choose the type of the result, based on previous result type.
        if (chatCompletion) {
          if ('choices' in chatCompletion) {
            const choice = chatCompletion?.choices[0];
            if (choice) {
              let resultType: TaskResult['type'] = 'ChatAnswer';
              if (
                task.result?.type === 'ToolResult' ||
                task.result?.type === 'ToolError'
              ) {
                resultType = 'ToolResultInterpretation';
              } else if (useToolChat) {
                resultType = 'ToolChatResult';
              } else if (isOpenAIFunctionCall(choice)) {
                resultType = 'ToolCall';
              }
              task.result = {
                ...task.result,
                type: resultType,
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
            openAIConversationThread,
            await taskManager.searchToolDefinitions()
          );
        }
      }
    } else {
      throw new Error('Task has no inference model selected!');
    }
  }

  return task;
}

async function processFunctionTask(
  task: LLMTask,
  tools: Record<string, ToolBase | Tool>,
  taskWorkerController: TaskWorkerController,
  taskManager: TyTaskManager
) {
  if ('functionCall' in task.content) {
    const func = task.content.functionCall;
    console.log(`Calling function ${func.name}`);
    if (tools[func.name] && !taskWorkerController.isInterrupted()) {
      const result = await handleFunctionExecution(func, tools, taskManager);
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
  role: partialTaskDraft['role'] | undefined,
  zodSchema: typeof yamlToolChatType | typeof toolResultChat
): Promise<{ taskDraft: partialTaskDraft; execute: boolean }> {
  // parse the response and create a new task filled with the correct parameters
  let yamlContent = message.trim();
  // Use exec() to find a match
  const yamlBlockRegex = /```(yaml|YAML)\n?([\s\S]*?)\n?```/;
  const yamlMatch = yamlBlockRegex.exec(yamlContent);
  if (yamlMatch) {
    yamlContent = yamlMatch[2]; // Use the captured group
  }
  // Parse the extracted or original YAML content
  const parsedYaml = load(yamlContent);
  const toolChatResult = await zodSchema.strict().safeParseAsync(parsedYaml);
  if (toolChatResult.success) {
    console.log(toolChatResult);
    if (toolChatResult.data.toolCommand) {
      return {
        taskDraft: {
          role: 'function',
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
    const delimiters = '```';
    return {
      taskDraft: {
        state: 'Completed',
        role: role || 'system',
        content: `Error parsing response:\n${
          delimiters + yamlContent + '\n' + delimiters
        }\nError: ${toolChatResult.error.toString()}`,
      },
      execute: false,
    };
  }
}

// this function takes a task and generates follow up tasks automatically
// it also checks whether we should immediatly execute them or not...
async function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  chatState: ChatStateType,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController
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
          content: choice.message.content || undefined,
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
    } else if (
      finishedTask.result.type === 'ToolChatResult' ||
      finishedTask.result.type === 'ToolResultInterpretation'
    ) {
      const choice = finishedTask.result.chatResponse?.choices[0];
      let taskDraft: partialTaskDraft | undefined = undefined;
      ({ taskDraft, execute } = await parseChatResponse(
        choice?.message.content || '',
        choice?.message.role,
        finishedTask.result.type == 'ToolResultInterpretation'
          ? toolResultChat
          : yamlToolChatType
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
        const functionCall = extractOpenAIFunctions(
          choice,
          await taskManager.searchToolDefinitions()
        );
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

    // and finally convert the entire list of tasks to
    // a real task.
    for (const taskDraft of taskDraftList) {
      taskDraft.debugging = { ...taskDraft.debugging, ...childCosts };
      // we do not want to queue up follow-up tasks for execution, if the task flow was
      // interrupted
      execute = taskWorkerController.isInterrupted() ? false : execute;
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

class InterruptError extends Error {
  // TODO: make sure, we can throw that error in a few spots! :) E.g. Function processing
  constructor(reason: string) {
    super(`Interrupted with reason: ${reason}`);
  }
}

export class TaskWorkerController {
  /* This class adds context to task executions during the runtime.
  We don't necessarily need to save this information in the database
  It also gives us the ability to control the task worker process

  - We can interrupt/cancel task processing
  - we can track number of error in a task chain and cancel, if too many errors appear
  - we can track other information
  - we can gracefully exist streamed tasks 
  - and more..
  */
  interrupted: boolean;
  interruptReason: string | null;
  interruptCallbacks: ((reason: string | null) => void)[];

  constructor() {
    this.interrupted = false;
    this.interruptReason = null;
    this.interruptCallbacks = [];
  }

  interrupt(reason: string | null = null): void {
    console.log('interrupting: ', reason);
    this.interrupted = true;
    this.interruptReason = reason;
    this.interruptCallbacks.forEach((callback) => callback(reason));
  }

  isInterrupted(): boolean {
    return this.interrupted;
  }

  getInterruptReason(): string | null {
    return this.interruptReason;
  }

  reset(full = true): void {
    this.interrupted = false;
    this.interruptReason = null;
    if (full) {
      this.interruptCallbacks = [];
    }
  }

  onInterrupt(callback: (reason: string | null) => void): void {
    this.interruptCallbacks.push(callback);
  }
}

async function processTask(
  task: LLMTask,
  taskManager: TyTaskManager,
  taskId: string,
  chatState: ChatStateType,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController
) {
  // TODO: this whole function needs to be more "functional" e.g. we need to make sure, that we don't "alter" existing tasks which
  //       are already in the db and throw errors if we do that.
  // TODO: make this function return a promise so taht we can interrupt it anytime!
  // return new Promise((resolve, reject) => {
  try {
    void taskManager.updateTask(
      {
        id: taskId,
        state: 'In Progress',
      },
      false
    );

    if (task.role == 'user') {
      // TODO: get rid of "taskManager" in processChatTask
      task = await processChatTask(
        task,
        chatState,
        apiKeys,
        taskManager,
        taskWorkerController
      );
      task.state = 'Completed';
    } else if (task?.role == 'function') {
      // in the case of 'FunctionCall' result, we run it twice:
      // 1. calculate function result
      //   then, we set it to "queued" status in order to prevent it form being deleted from the queue.
      //   this time, it has a "ToolResult" which means, we are sending it to an LLM for interpretation:
      // 2. send function to LLM inference
      // the task could potentially come back as another functionCall!
      // the way this works: -> task state is "Completed" with "FunctionCall" and follow-up
      // functiontask will be generated
      if (
        task.result?.type === 'ToolResult' ||
        task.result?.type === 'ToolError'
      ) {
        // here we send the task to our LLM inference
        task = await processChatTask(
          task,
          chatState,
          apiKeys,
          taskManager,
          taskWorkerController
        );
        task.state = 'Completed';
      } else {
        // in the case we don't have a result yet, we need to calculate it :)
        task = await processFunctionTask(
          task,
          await taskManager.searchToolDefinitions(),
          taskWorkerController,
          taskManager
        );
        if (!taskWorkerController.isInterrupted()) {
          processTasksQueue.push(taskId); // send the task back into the queue
          task.state = 'Queued'; // and we queue the functino again, to be processed again, this time with an LLM
        } else {
          task.state = 'Completed';
        }
      }
    } else {
      console.log("We don't know what to do with this task:", taskId);
      task.state = 'Error';
    }
  } catch (error) {
    task.state = 'Error';
    if (error instanceof Error) {
      task.debugging.error = {
        message: error.message,
        stack: error.stack,
      };
    }
    console.error('Error processing task:', error);
  }
  return task;
}

export async function taskWorker(
  chatState: ChatStateType,
  taskManager: TyTaskManager,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController
) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    taskWorkerController.reset(); // make sure we reset our execution context interrupt, so that we can interrupt in the next loop again :)
    try {
      // in case of errors, especially if its an interrupt event we simply want to cancel everything :P
      const taskId = await processTasksQueue.pop();
      console.log('processing task:', taskId);
      let task = await taskManager.getTask(taskId);
      if (task) {
        task = await processTask(
          task,
          taskManager,
          taskId,
          chatState,
          apiKeys,
          taskWorkerController
        );
        // create a new task form the result. E.g. in the case of a simple chat, this will
        // create a task with the Answer of the LLM which then gets displayed in the chatwindow...
        await generateFollowUpTasksFromResult(
          task,
          chatState,
          taskManager,
          taskWorkerController
        );
        // and finally save the task
        void taskManager.setTask(task, true);
      }
    } catch (error) {
      console.error('Could not process task:', error);
      // TODO: Depending on error, clean out the queue...
      if (error instanceof InterruptError) {
        console.log(`Loop interrupted with reason: ${error.message}`);
        break;
      } else {
        throw error;
      }
      // if we realize that a cancellation event was sent, empty the queue and set all tasks to "Cancelled"
      /*if (!processTasksQueue.count()) {
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
      }*/
    }
  }
}
