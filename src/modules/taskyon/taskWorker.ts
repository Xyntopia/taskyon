import {
  callLLM,
  getOpenAIAssistantResponse,
  enrichWithDelayedUsageInfos,
  estimateChatTokens,
  generateHeaders,
  getOpenRouterGenerationInfo,
} from './chat';
import {
  generateCompleteChat,
  generateOpenAIToolDeclarations,
} from './promptCreation';
import {
  FunctionCall,
  partialTaskDraft,
  TaskNode,
  StructuredResponse,
  OpenRouterGenerationInfo,
  llmSettings,
  ToolBase,
  TaskProcessingError,
  yesnoToBoolean,
} from './types';
import { addTask2Tree, processTasksQueue } from './taskManager';
import type { OpenAI } from 'openai';
import { TyTaskManager } from './taskManager';
import { Tool, handleFunctionExecution } from './tools';
import { load } from 'js-yaml';
import { deepCopy, deepMerge, sleep } from './utils';
import { isTaskyonKey } from './crypto';

function extractOpenAIFunctions(
  choice: OpenAI.ChatCompletion['choices'][0],
  tools: Record<string, ToolBase>,
) {
  const functionCalls: FunctionCall[] = [];
  for (const toolCall of choice.message.tool_calls || []) {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...');
    const functionCall = FunctionCall.parse(toolCall.function);
    if (tools[functionCall.name]) {
      functionCalls.push(functionCall);
    }
  }
  return functionCalls;
}

// this function processes all tasks which go to any sort of an LLM
export async function processChatTask(
  task: TaskNode,
  llmSettings: llmSettings,
  apiKey: string,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  // TODO: refactor this function!
  // TODO: can we interrupt non-streaming tasks? possibly using an AbortController.
  //TODO: merge this function with the assistants function
  if (llmSettings.useOpenAIAssistants && llmSettings.selectedApi == 'openai') {
    const messages = await getOpenAIAssistantResponse(
      task,
      apiKey,
      llmSettings.openAIAssistantId,
      taskManager,
    );
    if (messages) {
      task.result = {
        assistantResponse: messages,
      };
    }
  } else {
    const api = getApiConfigCopy(llmSettings, task.configuration?.chatApi);
    if (!api) {
      throw new Error(
        `api doesn\'t exist! ${llmSettings.selectedApi || 'no api selected!'}`,
      );
    }
    const selectedModel = task.configuration?.model;
    if (selectedModel) {
      api.selectedModel = selectedModel;
      console.log('execute chat task!', task);
      //TODO: also do this, if we start the task "autonomously" in which we basically
      //      allow it to create new tasks...
      //TODO: we can create more things here like giving it context form other tasks, lookup
      //      main objective, previous tasks etc....
      const { openAIConversationThread, toolDefs } = await generateCompleteChat(
        task,
        llmSettings,
        taskManager,
      );
      let tools: OpenAI.ChatCompletionTool[] = [];
      if (llmSettings.enableOpenAiTools) {
        tools = generateOpenAIToolDeclarations(task, toolDefs);
      }

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
          }, // define a function to check whether we should cancel the stream ...
        );

        task.result = {
          chatResponse: chatCompletion,
        };

        // get llm inference stats
        // TODO: we should replace this with an inference task which has the LLM as a parent...
        if (chatCompletion && llmSettings.selectedApi === 'openrouter.ai') {
          void sleep(5000).then(() => {
            void getOpenRouterGenerationInfo(
              chatCompletion.id,
              generateHeaders(
                apiKey,
                llmSettings.siteUrl,
                llmSettings.selectedApi || '',
              ),
            ).then((generationInfo) => {
              enrichWithDelayedUsageInfos(task, taskManager, generationInfo);
            });
          });
        } else if (
          chatCompletion &&
          llmSettings.selectedApi === 'taskyon' &&
          !chatCompletion.model.endsWith(':free') &&
          apiKey &&
          !isTaskyonKey(apiKey, false)
        ) {
          // our backend tries to get the finished costs
          // after ~4000ms, so we wait for 6000 here...
          void sleep(6000).then(() => {
            const headers = {
              ...llmSettings.llmApis['taskyon']?.defaultHeaders,
              ...generateHeaders(apiKey, llmSettings.siteUrl, api.name),
            };
            const baseUrl = new URL(api.baseURL).origin;
            console.log('get generation info from ', baseUrl);
            const url = `${baseUrl}/rest/v1/api_usage_log?select=reference_data&id=eq.${chatCompletion.id}`;
            void fetch(url, { headers })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(
                    `Could not find generation information for task ${task.id}`,
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
                    data[0]?.reference_data,
                  );
                }
              });
          });
        } else if (chatCompletion?.usage) {
          // openai sends back the exact number of prompt tokens :)
          task.debugging.promptTokens = chatCompletion.usage.prompt_tokens;
          task.debugging.resultTokens = chatCompletion.usage.completion_tokens;
          task.debugging.taskTokens = chatCompletion.usage.total_tokens;
        } else {
          task.debugging.estimatedTokens = await estimateChatTokens(
            task,
            openAIConversationThread,
            await taskManager.searchToolDefinitions(),
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
  task: TaskNode,
  tools: Record<string, ToolBase | Tool>,
  taskWorkerController: TaskWorkerController,
  taskManager: TyTaskManager,
) {
  if ('functionCall' in task.content) {
    const func = task.content.functionCall;
    console.log(`Calling function ${func.name}`);
    if (tools[func.name] && !taskWorkerController.isInterrupted()) {
      const result = await handleFunctionExecution(func, tools, taskManager);
      task.result = result;
    } else {
      const toolnames = JSON.stringify(task.allowedTools);
      throw new TaskProcessingError(
        !taskWorkerController.isInterrupted()
          ? `The function '${func.name}' is not available in tools. Please select a valid function from this list: ${toolnames}`
          : 'The function execution was cancelled by taskyon',
      );
    }
  }
  return task;
}

async function parseChatResponse2TaskDraft(
  message: string,
): Promise<StructuredResponse> {
  // parse the response and create a new task filled with the correct parameters
  let yamlContent = message.trim();
  // Use exec() to find a match
  const yamlBlockRegex = /```(?:yaml|YAML|[^\n]*)\n?([\s\S]*?)\n?```/;
  const yamlMatch = yamlBlockRegex.exec(yamlContent);
  if (yamlMatch && yamlMatch[1]) {
    yamlContent = yamlMatch[1]; // Use the captured group
  }

  let parsedYaml: unknown = undefined;
  try {
    // Parse the extracted or original YAML content
    parsedYaml = load(yamlContent);
  } catch (err) {
    throw new TaskProcessingError('Error converting the response to yaml', {
      yamlString: yamlContent,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    });
  }
  const structuredResponseResult =
    await StructuredResponse.safeParseAsync(parsedYaml);

  if (!structuredResponseResult.success) {
    // TODO: as our object is completly partial, this never gets caled
    // right now..  do we `need` to have any checks here?
    throw new TaskProcessingError(
      'ZOD parse error: Unknown response object type:',
      structuredResponseResult.error.format(),
    );
  }
  return structuredResponseResult.data;
}

/**
 * This function takes a task and generates follow up tasks automatically
 * based on content of the result!.
 * it also checks whether we should immediatly execute them or not...
 * basically we need to decide here what kind of a follow up task we are going to do
 *
 * @param finishedTask
 * @param llmSettings
 * @param taskManager
 * @param taskWorkerController
 * @returns
 *
 * following different types of task contents are possible:
 *
 * - MessageContent
 *    * string
 *    * structured Response (_s)
 * - ToolCallContent
 * - UploadedFilesContent
 * - ToolResultContent
 *
 * 
 * Tasks can have different *roles* which indicates who produced the content for a task: 
 * [User, Assistant (-> the AI), System (e.g. producing an error message), Function (produced by the function itself)]
 
here is a chart of the relations:

```mermaid
flowchart TD
    subgraph ContentTypes
        MessageContent_A[MessageContent_A]
        MessageContent_U[MessageContent_U]
        MessageContent_S[MessageContent_S]
        MessageContent_s_A[MessageContent_s_A]
        ToolCallContent[ToolCallContent_F]
        ToolResultContent_F[ToolResultContent_S]
        UploadedFilesContent[UploadedFilesContent_A/U]
    end

    subgraph Events
        TERMINATION{{TERMINATION}}
        ERROR{{ERROR}}
    end

    MessageContent_A --> TERMINATION
    MessageContent_U -- if tools enabled--> MessageContent_s_A
    MessageContent_U -- with llm tool support--> ToolCallContent
    MessageContent_U -- with llm tool support--> MessageContent_A
x    MessageContent_U --> MessageContent_A
    MessageContent_s_A --> MessageContent_A
    MessageContent_s_A --> ToolCallContent
x    ToolCallContent --> ToolResultContent_F
    UploadedFilesContent --> MessageContent_A
    UploadedFilesContent --if tools enabled--> MessageContent_s_A
x    ToolResultContent_F --> MessageContent_s_A
    MessageContent_S --> MessageContent_s_A
    ERROR --> MessageContent_S

```

 * 
 *
 */
// TODO: split up this function into a "parse" and "addTask part"
//       this would give us better error information. and better code ;).
async function generateFollowUpTasksFromResult(
  finishedTask: TaskNode,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  console.log('generate follow up task');
  const childCosts = {
    promptTokens: finishedTask.debugging.resultTokens,
    taskTokens: finishedTask.debugging.taskTokens,
    taskCosts: finishedTask.debugging.taskCosts,
  };
  const useTyTools = finishedTask.allowedTools?.length ? true : false;
  // use helper function to make code more concise ;)
  const addFollowUpTask = async (
    execute: boolean,
    partialTask: partialTaskDraft,
  ) => {
    partialTask.debugging = { ...partialTask.debugging, ...childCosts };
    const taskTemplate: Partial<TaskNode> = {
      configuration: finishedTask.configuration,
    };
    const newTask = deepMerge(taskTemplate, partialTask);
    newTask.state = execute ? 'Open' : 'Completed';
    const newTaskId = await addTask2Tree(
      newTask,
      partialTask.parentID || finishedTask.id,
      taskManager,
      // interrupt execution if interrupted flag is shown!
      // this makes sure that results are still saved, even if we stop any
      // further execution
      taskWorkerController.isInterrupted() ? false : execute,
    );
    llmSettings.selectedTaskId = newTaskId;
    return newTaskId;
  };

  // TODO: what do we do in case of an empty user message, but only a file?
  //       right now, we assume, that user message always comes after uploaded file message :)
  if (finishedTask.result) {
    if (
      'functionCall' in finishedTask.content &&
      finishedTask.result.toolResult
    ) {
      void addFollowUpTask(true, {
        role: 'system',
        content: { toolResult: finishedTask.result.toolResult },
      });
      return;
    }

    const choice = finishedTask.result?.chatResponse?.choices[0];
    if (choice) {
      // check if we have any functioncalls from the llm inference
      const functionCall = extractOpenAIFunctions(
        choice,
        await taskManager.searchToolDefinitions(),
      );
      if (functionCall[0]) {
        // TODO: enable multiple parallel function calls
        void addFollowUpTask(true, {
          role: 'function',
          content: { functionCall: functionCall[0] },
        });
        return;
      }

      if (!choice.message.content) {
        throw new TaskProcessingError(
          'The response content from the AI was empty!',
          {
            choice,
          },
        );
      }
      // simply return the answer as a normal chat message
      if (
        'message' in finishedTask.content &&
        finishedTask.role === 'user' &&
        !useTyTools
      ) {
        void addFollowUpTask(false, {
          role: 'assistant',
          content: { message: choice.message.content },
        });
        return;
      } else if (
        ('message' in finishedTask.content &&
          finishedTask.role === 'user' &&
          useTyTools) ||
        'toolResult' in finishedTask.content ||
        finishedTask.role === 'system' // this happens e.g. in the case of an error...
      ) {
        // depending on what role and tasktype the finishedTask has, we
        // expect different results from our structuredResponse
        // TODO: we need to do some plausibilitychecks here:
        //       - e.g. if use tool=true, but no toolCommand present
        // actually, it would be better to do this in the structreReponse processing ? :)
        const structResponse = await parseChatResponse2TaskDraft(
          choice.message.content || '',
        );
        // we immediatly generate a follow up response here based on the structResponse. This avoids
        // having to process it in another loop as we know the result already anyways.
        // the "structuredMessage" type is mainly there so that the LLM can see what it said :).
        // e.g. in case there is an error...

        // In fact we always decide right here, what we do *after* the structured response and simply add the
        // structured response as a normal "message" task to the chain...
        // this way we can put all the parsing logic & interpretation and all of this here. While
        // our tasks only have to process the actual data ther're receiving

        const retry =
          !yesnoToBoolean(structResponse.stop) ||
          yesnoToBoolean(structResponse['try again']) ||
          yesnoToBoolean(structResponse['should we retry?']);

        if (
          'toolCommand' in structResponse &&
          structResponse.toolCommand?.name &&
          retry
        ) {
          const newTaskid = await addFollowUpTask(false, {
            role: 'assistant',
            content: { structuredResponse: choice.message.content },
          });
          void addFollowUpTask(true, {
            parentID: newTaskid,
            role: 'assistant',
            content: { functionCall: structResponse.toolCommand },
          });
        } else {
          // in the case that we don't call a tool, provide a "normal" answer :)
          // this time we declare it as "Open" and set execution to "true"
          void addFollowUpTask(true, {
            role: 'assistant',
            content: { structuredResponse: choice.message.content },
          });
        }
        return;
      } else {
        // if 'message' in finishedTask.content && finishedTask.role === 'assistant'
        // this is the final response, so we simply add it to the chain without executing it
        void addFollowUpTask(false, {
          role: 'assistant',
          content: { message: choice.message.content },
        });
        console.log('No more follow up tasks!');
        return;
      }
      //const newTaskDraftList = createNewAssistantResponseTask(finishedTask);
      // TODO: Assistants don't work right now! we need to create a sequential
      //       task chain here and add each tasks new ID to the net one as a parent",
    }
  }
}

export function useTaskWorkerController() {
  /* This class adds context to task executions during the runtime.
  We don't necessarily need to save this information in the database
  It also gives us the ability to control the task worker process

  - We can interrupt/cancel task processing
  - we can track number of error in a task chain and cancel, if too many errors appear
  - we can track other information
  - we can gracefully exist streamed tasks 
  - and more..
  */
  let interrupted = true;
  let interruptReason: string | null = null;
  let interruptCallbacks: ((reason: string | null) => void)[] = [];
  let waiting = false;
  let errorCount = 0;

  function interrupt(reason: string | null = null): void {
    console.log('interrupting: ', reason);
    interrupted = true;
    interruptReason = reason;
    interruptCallbacks.forEach((callback) => callback(reason));
  }

  function isWaiting() {
    return waiting;
  }

  function setWaiting(value: boolean) {
    console.log('task worker is waiting!');
    waiting = value;
  }

  function isInterrupted(): boolean {
    return interrupted;
  }

  function getInterruptReason(): string | null {
    return interruptReason;
  }

  function reset(full = true): void {
    interrupted = false;
    interruptReason = null;
    errorCount = 0;
    if (full) {
      interruptCallbacks = [];
    }
  }

  function onInterrupt(callback: (reason: string | null) => void): void {
    interruptCallbacks.push(callback);
  }

  return {
    interrupt,
    isInterrupted,
    getInterruptReason,
    reset,
    onInterrupt,
    isWaiting,
    setWaiting,
    increaseErrorCount: () => {
      errorCount++;
    },
    getErrorCount: () => {
      return errorCount;
    },
  };
}
export type TaskWorkerController = ReturnType<typeof useTaskWorkerController>;

async function getTaskResult(
  task: TaskNode,
  taskManager: TyTaskManager,
  taskId: string,
  llmSettings: llmSettings,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController,
) {
  // TODO: make this function return a promise so taht we can interrupt it anytime!
  // return new Promise((resolve, reject) => {
  void taskManager.updateTask(
    {
      id: taskId,
      state: 'In Progress',
    },
    false,
  );

  if (
    'message' in task.content ||
    'toolResult' in task.content ||
    'structuredResponse' in task.content
  ) {
    // TODO: get rid of "taskManager" in processChatTask
    if (llmSettings.selectedApi) {
      const apiKey = apiKeys[llmSettings.selectedApi];
      task = await processChatTask(
        task,
        llmSettings,
        apiKey || '',
        taskManager,
        taskWorkerController,
      );
    } else {
      throw new TaskProcessingError("we don't have any APIs selected!");
    }
  } else if ('functionCall' in task.content) {
    // calculate function result
    // in the case we don't have a result yet, wPe need to calculate it :)
    task = await processFunctionTask(
      task,
      await taskManager.searchToolDefinitions(),
      taskWorkerController,
      taskManager,
    );
  } else {
    throw new TaskProcessingError(
      "We don't know how to process this task to get a result.",
    );
  }

  task.state = 'Completed';
  return task;
}

export async function taskWorker(
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController,
) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    let task: TaskNode | undefined = undefined;
    try {
      if (taskWorkerController.isInterrupted()) {
        // in case of errors, especially if its an interrupt event we simply want to cancel everything :P
        // empty our task queue :)
        console.log('clear out task queue due to interruption');
        processTasksQueue.clear();
      }

      if (processTasksQueue.count() === 0) {
        taskWorkerController.setWaiting(true);
      }
      const taskId = await processTasksQueue.pop();
      taskWorkerController.setWaiting(false);
      if (taskWorkerController.isInterrupted()) {
        // don't process tasks anymore..  all we can do now is to wait until the user manually presses the
        // "reset" button ;)
        continue;
      }

      // make sure we know from outside that the worker is active...
      console.log('processing task:', taskId);
      task = await taskManager.getTask(taskId);
      if (task && !taskWorkerController.isInterrupted()) {
        task = await getTaskResult(
          task,
          taskManager,
          taskId,
          llmSettings,
          apiKeys,
          taskWorkerController,
        );
        // create a new task form the result. E.g. in the case of a simple chat, this will
        // create a task with the Answer of the LLM which then gets displayed in the chatwindow...
        await generateFollowUpTasksFromResult(
          task,
          llmSettings,
          taskManager,
          taskWorkerController,
        );
        // and finally save the task
        void taskManager.setTask(task, true);
      }
    } catch (error) {
      console.error('Could not complete task iteration:', error);
      taskWorkerController.increaseErrorCount();
      if (
        taskWorkerController.getErrorCount() >= llmSettings.maxAutonomousTasks
      ) {
        taskWorkerController.interrupt(
          `Too many errors occured, interrupting execution after ${taskWorkerController.getErrorCount()} errors!`,
        );
      }

      if (task) {
        task.state = 'Error';
      }

      const errorTask: partialTaskDraft = {
        role: 'system',
        configuration: task?.configuration,
        content: {
          message: `An error occured:\n\n\`\`\`\n${JSON.stringify(error)}\n\`\`\``,
        },
      };
      if (error instanceof TaskProcessingError) {
        errorTask.content = {
          //message: `An error occured: ${error.message}:\n\n${dump(error.details, { skipInvalid: true })}`,
          message: `An error occured:\n\n\`\`\`\n${error.message}${error.details ? ':\n\n' + JSON.stringify(error.details) : ''}\n\`\`\``,
        };
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              name: error.name,
              details: error.details,
            },
          };
        }
      } else if (error instanceof Error) {
        errorTask.content = {
          message: `An error occured:\n\n\`\`\`\n${error.message}\n\n${JSON.stringify(error)}\n\`\`\``,
        };
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              stack: error.stack,
              location: 'task processing',
              cause: error.cause,
            },
          };
        }
      }

      const newTaskId = await addTask2Tree(
        errorTask,
        task?.id,
        taskManager,
        // interrupt execution if interrupted flag is shown!
        // this makes sure that results are still saved, even if we stop any
        // further execution
        taskWorkerController.isInterrupted() ? false : true,
      );
      llmSettings.selectedTaskId = newTaskId;

      // TODO: run this taskWorker in a separate worker js/browser thread!
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
export function getApiConfig(llmSettings: llmSettings) {
  if (llmSettings.selectedApi) {
    return llmSettings.llmApis[llmSettings.selectedApi];
  }
}

function getApiConfigCopy(llmSettings: llmSettings, apiName?: string) {
  const searchName = apiName || llmSettings.selectedApi;
  if (searchName) {
    const api = llmSettings.llmApis[searchName];
    return deepCopy(api);
  }
}
