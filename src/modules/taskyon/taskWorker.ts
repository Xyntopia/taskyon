import {
  callLLM,
  getOpenAIAssistantResponse,
  llmSettings,
  enrichWithDelayedUsageInfos,
  estimateChatTokens,
  generateHeaders,
  getApiConfigCopy,
  getOpenRouterGenerationInfo,
} from './chat';
import { renderTasks4Chat } from './promptCreation';
import {
  FunctionArguments,
  FunctionCall,
  partialTaskDraft,
  LLMTask,
  TaskResult,
  StructuredResponse,
  OpenRouterGenerationInfo,
} from './types';
import { addTask2Tree, processTasksQueue } from './taskManager';
import type { OpenAI } from 'openai';
import { TyTaskManager } from './taskManager';
import { Tool, handleFunctionExecution } from './tools';
import { ToolBase } from './types';
import { dump, load } from 'js-yaml';
import { deepMerge, sleep } from './utils';

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
  llmSettings: llmSettings,
  apiKey: string,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController
) {
  // TODO: refactor this function!
  // TODO: can we interrupt non-streaming tasks? possibly using an AbortController.
  //TODO: merge this function with the assistants function
  if (llmSettings.useOpenAIAssistants && llmSettings.selectedApi == 'openai') {
    const messages = await getOpenAIAssistantResponse(
      task,
      apiKey,
      llmSettings.openAIAssistantId,
      taskManager
    );
    if (messages) {
      task.result = {
        type: 'AssistantAnswer',
        assistantResponse: messages,
      };
    }
  } else {
    const api = getApiConfigCopy(llmSettings, task.configuration?.chatApi);
    if (!api) {
      throw new Error(`api doesn\'t exist! ${llmSettings.selectedApi}`);
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
        task.allowedTools?.length && !llmSettings.enableOpenAiTools;

      const { openAIConversationThread, tools } = await renderTasks4Chat(
        task,
        await taskManager.searchToolDefinitions(),
        llmSettings,
        taskManager.buildChatFromTask,
        useToolChat ? 'toolchat' : 'chat'
      );

      if (openAIConversationThread.length > 0) {
        const chatCompletion = await callLLM(
          openAIConversationThread,
          tools,
          api,
          llmSettings.siteUrl,
          apiKey,
          // if the task runs in the "foreground", stream it :)
          task.id == llmSettings.selectedTaskId ? true : false,
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
                task.result?.type === 'ToolError' ||
                useToolChat
              ) {
                resultType = 'StructuredChatResponse';
                // TODO: also add ToolCall to StructuredChatResponse by converting the result into
                // a structured response
              } else if (isOpenAIFunctionCall(choice)) {
                resultType = 'ToolCall';
              }
              // TODO: remove the following default result merge and only use the chatcompletion result...
              task.result = {
                ...task.result,
                type: resultType,
                chatResponse: chatCompletion,
              };
            }
          } else {
            // if something goes wrong on the LLM side
            // (OpenAI e.g. usually reports back the error in chatCompletion...)
            throw new Error(JSON.stringify(chatCompletion));
          }
        }

        // get llm inference stats
        // TODO: we should replace this with an inference task which has the LLM as a parent...
        if (chatCompletion && llmSettings.selectedApi === 'openrouter.ai') {
          void sleep(5000).then(() => {
            void getOpenRouterGenerationInfo(
              chatCompletion.id,
              generateHeaders(
                apiKey,
                llmSettings.siteUrl,
                llmSettings.selectedApi
              )
            ).then((generationInfo) => {
              enrichWithDelayedUsageInfos(task, taskManager, generationInfo);
            });
          });
        } else if (
          chatCompletion &&
          llmSettings.selectedApi === 'taskyon' &&
          !chatCompletion.model.endsWith(':free')
        ) {
          if (apiKey) {
            // our backend tries to get the finished costs
            // after ~4000ms, so we wait for 6000 here...
            void sleep(6000).then(() => {
              const headers = {
                ...llmSettings.llmApis['taskyon'].defaultHeaders,
                ...generateHeaders(apiKey, llmSettings.siteUrl, api.name),
              };
              const baseUrl = new URL(api.baseURL).origin;
              console.log('get generation info from ', baseUrl);
              const url = `${baseUrl}/rest/v1/api_usage_log?select=reference_data&id=eq.${chatCompletion.id}`;
              void fetch(url, { headers })
                .then((response) => {
                  if (!response.ok) {
                    throw new Error(
                      `Could not find generation information for task ${task.id}`
                    );
                  }
                  return response.json() as Promise<
                    { reference_data: OpenRouterGenerationInfo }[]
                  >;
                })
                .then((data) => {
                  console.log('taskyon generation info:', data);
                  if (data.length) {
                    enrichWithDelayedUsageInfos(
                      task,
                      taskManager,
                      data[0].reference_data
                    );
                  }
                });
            });
          }
        } else if (chatCompletion?.usage) {
          // openai sends back the exact number of prompt tokens :)
          task.debugging.promptTokens = chatCompletion.usage.prompt_tokens;
          task.debugging.resultTokens = chatCompletion.usage.completion_tokens;
          task.debugging.taskTokens = chatCompletion.usage.total_tokens;
        } else {
          task.debugging.estimatedTokens = await estimateChatTokens(
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
          error: taskWorkerController.isInterrupted()
            ? `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`
            : 'The function execution was cancelled by taskyon',
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
      content: {
        message: allText
          .map((textContent) => textContent.text.value)
          .join('\n'),
      },
      debugging: { threadMessage: tm },
    });
  }
  return taskListFromResponse;
}

async function parseChatResponse2TaskDraft(
  message: string
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
  const structuredResponse = await StructuredResponse.safeParseAsync(
    parsedYaml
  );
  // TODO: test & handle more special cases such as when we have an asnwer & toolcall, or if our tool descriptions
  //       don't really work very well...
  if (structuredResponse.success) {
    console.log(structuredResponse);
    if (structuredResponse.data.toolCommand) {
      return {
        taskDraft: {
          role: 'function',
          content: {
            functionCall: structuredResponse.data.toolCommand,
          },
        },
        execute: true,
      };
    } else {
      return {
        taskDraft: {
          state: 'Completed',
          role: 'assistant',
          content: {
            message:
              structuredResponse.data.answer ||
              structuredResponse.data['describe your thoughts'] ||
              message,
          },
        },
        execute: false,
      };
    }
  } else {
    const delimiters = '```';
    const message = `Error parsing response:\n${
      delimiters + yamlContent + '\n' + delimiters
    }\nError: ${structuredResponse.error.toString()}`;
    throw Error(message);
  }
}

// this function takes a task and generates follow up tasks automatically
// based on the type of result that we got.
// it also checks whether we should immediatly execute them or not...
async function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController
) {
  console.log('generate follow up task');
  const childCosts = {
    promptTokens: finishedTask.debugging.resultTokens,
    taskTokens: finishedTask.debugging.taskTokens,
    taskCosts: finishedTask.debugging.taskCosts,
  };
  // use helper function to make code more concise ;)
  const addFollowUpTask = (execute: boolean, taskDraft: partialTaskDraft) => {
    taskDraft.debugging = { ...taskDraft.debugging, ...childCosts };
    void addTask2Tree(
      taskDraft,
      finishedTask.id,
      llmSettings,
      taskManager,
      // interrupt execution if interrupted flag is shown!
      // this makes sure that results are still saved, even if we stop any
      // further execution
      taskWorkerController.isInterrupted() ? false : execute
    );
  };
  const taskTemplate: Partial<LLMTask> = {
    configuration: finishedTask.configuration,
  };
  if (finishedTask.result) {
    const choice = finishedTask.result.chatResponse?.choices[0];

    // TODO: use a switch statement here :)
    if (finishedTask.result.type === 'ChatAnswer') {
      if (choice) {
        addFollowUpTask(false, {
          state: 'Completed',
          role: choice.message.role,
          content: { message: choice.message.content || '' },
        });
      }
    } else if (finishedTask.result.type === 'AssistantAnswer') {
      const newTaskDraftList = createNewAssistantResponseTask(finishedTask);
      for (const td of newTaskDraftList) {
        throw Error(
          "It doesn't work right now! we need to create a sequential task chain here and add each tasks new ID to the net one as a parent"
        );
        addFollowUpTask(false, {
          state: 'Completed',
          ...td,
        });
      }
    } else if (
      finishedTask.result.toolResult &&
      ['ToolResult', 'ToolError'].includes(finishedTask.result.type)
    ) {
      addFollowUpTask(true, {
        ...taskTemplate,
        state: 'Open',
        role: 'assistant',
        content: { functionResult: finishedTask.result.toolResult },
      });
    } else if (finishedTask.result.type === 'StructuredChatResponse') {
      const { taskDraft, execute } = await parseChatResponse2TaskDraft(
        choice?.message.content || ''
      );
      if (taskDraft) {
        addFollowUpTask(execute, deepMerge(taskTemplate, taskDraft));
      }
      // TODO: integrate ToolCall with StruturedChatResponse
    } else if (finishedTask.result.type === 'ToolCall') {
      if (choice) {
        const functionCall = extractOpenAIFunctions(
          choice,
          await taskManager.searchToolDefinitions()
        );
        if (functionCall) {
          addFollowUpTask(
            true,
            deepMerge(taskTemplate, {
              role: 'function',
              content: { function: functionCall[0] },
            })
          );
        }
      }
    }
  }
  if (finishedTask.debugging.error) {
    console.log('creating error-follow up!');
    const error = finishedTask.debugging.error as {
      message?: string;
      cause?: unknown;
    };
    const message = dump(
      JSON.parse(
        JSON.stringify({ message: error.message, cause: error.cause }, null, 3)
      )
    );
    addFollowUpTask(
      false,
      deepMerge(taskTemplate, {
        state: 'Completed',
        role: 'system',
        content: { message },
      })
    );
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
  llmSettings: llmSettings,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController
) {
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

    if ('message' in task.content || 'functionResult' in task.content) {
      // TODO: get rid of "taskManager" in processChatTask
      const apiKey = apiKeys[llmSettings.selectedApi];
      task = await processChatTask(
        task,
        llmSettings,
        apiKey,
        taskManager,
        taskWorkerController
      );
    } else if ('functionCall' in task.content) {
      // calculate function result
      // in the case we don't have a result yet, we need to calculate it :)
      task = await processFunctionTask(
        task,
        await taskManager.searchToolDefinitions(),
        taskWorkerController,
        taskManager
      );
    } else {
      throw new Error("We don't know what to do with this task");
    }
  } catch (error) {
    if (error instanceof Error) {
      task.debugging.error = {
        message: error.message,
        stack: error.stack,
        location: 'task processing',
        cause: error.cause,
      };
    }
    console.error('Error processing task:', error);
    return task;
  }
  task.state = 'Completed';
  return task;
}

export async function taskWorker(
  llmSettings: llmSettings,
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
          llmSettings,
          apiKeys,
          taskWorkerController
        );
        // create a new task form the result. E.g. in the case of a simple chat, this will
        // create a task with the Answer of the LLM which then gets displayed in the chatwindow...
        await generateFollowUpTasksFromResult(
          task,
          llmSettings,
          taskManager,
          taskWorkerController
        );
        // and finally save the task
        void taskManager.setTask(task, true);
      }
    } catch (error) {
      console.error('Could not complete task iteration:', error);
      // TODO: Depending on error, clean out the queue...
      if (error instanceof InterruptError) {
        console.log(`Loop interrupted with reason: ${error.message}`);
        continue;
      }

      // TODO: clean up task, create a new task with the error and  & decide if we want to try this task again!

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
