import {
  callLLM,
  enrichWithUsageInfos,
  generateHeaders,
  getOpenRouterGenerationInfo,
  getTaskyonCosts,
} from './chat'
import { useNlpWorker } from './webWorkerApi'
import { generateCompleteChat, generateOpenAIToolDeclarations } from './promptCreation'
import {
  FunctionCall,
  type partialTaskDraft,
  type TaskNode,
  type llmSettings,
  type ToolBase,
  TaskProcessingError,
  yesnoToBoolean,
  type OnInterruptFunc,
  ChatResponseType,
} from './types'
import type { OpenAI } from 'openai'
import { initAddTask2Tree, type TyTaskManager } from './taskManager'
import { type Tool, handleFunctionExecution } from './tools'
import { load } from 'js-yaml'
import {
  type AsyncQueue,
  deepCopy,
  keysToLowerCase,
  makeSerializable,
  normalizeFalsyValues,
  pickProperties,
  sleep,
} from '../utils'
import { isTaskyonKey } from './tyCrypto'

// get worker function for our chat :)
const { estimateChatTokens } = useNlpWorker()

function extractOpenAIFunctions(
  choice: ChatResponseType['choices'][0],
  tools: Record<string, ToolBase>,
) {
  const functionCalls: FunctionCall[] = []
  for (const toolCall of choice.message.tool_calls || []) {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...')
    // we convert the object into our own FunctionCall and afterwards parse it, to make
    // sure it really worked...
    const functionCallObj: FunctionCall = {
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments),
    }
    const functionCall = FunctionCall.parse(functionCallObj)
    if (tools[functionCall.name]) {
      functionCalls.push(functionCall)
    }
  }
  return functionCalls
}

// this function processes all tasks which go to any sort of an LLM
export async function processChatTask(
  task: TaskNode,
  llmSettings: llmSettings,
  apiKey: string,
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  const api = getApiConfigCopy(llmSettings, task.configuration?.chatApi)
  if (!api) {
    throw new Error(`api doesn't exist! ${llmSettings.selectedApi || 'no api selected!'}`)
  }
  const selectedModel = task.configuration?.model
  if (selectedModel) {
    api.selectedModel = selectedModel
    console.log('execute chat task!', task)
    //TODO: also do this, if we start the task "autonomously" in which we basically
    //      allow it to create new tasks...
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    const { openAIConversationThread, toolDefs } = await generateCompleteChat(
      task,
      llmSettings,
      taskManager,
    )
    let tools: OpenAI.ChatCompletionTool[] = []
    if (llmSettings.enableOpenAiTools) {
      tools = generateOpenAIToolDeclarations(task, toolDefs)
    }

    if (openAIConversationThread.length > 0) {
      const chatCompletion = await callLLM(
        openAIConversationThread,
        tools,
        api,
        llmSettings.siteUrl,
        apiKey,
        // TODO: if the task runs in the "foreground", stream it :)
        // task.id == llmSettings.selectedTaskId ? true : false, // this doesn't work, for some reason it doesn't always detect if we're running something in the forground...
        true, // for now, we always want to stream our task...
        // this function receives chunks if we stream and senfs them into
        // our original task in the debugging property to be displayed
        // "live" (this only works if our tasks structure in task manager is
        // reactive)
        (chunk) => {
          if (chunk?.choices[0]?.delta?.tool_calls) {
            chunk?.choices[0]?.delta?.tool_calls.forEach((t) => {
              task.debugging.toolStreamArgsContent = task.debugging.toolStreamArgsContent || {}
              if (t.function?.name) {
                task.debugging.toolStreamArgsContent[t.function.name] =
                  (task.debugging.toolStreamArgsContent[t.function.name] || '') +
                  (t.function?.arguments || '')
              }
            })
          }
          if (chunk?.choices[0]?.delta?.content) {
            task.debugging.streamContent =
              (task.debugging.streamContent || '') + chunk.choices[0].delta.content
          }
        },
        () => {
          return taskWorkerController.isInterrupted()
        }, // define a function to check whether we should cancel the stream ...
      )

      task.result = chatCompletion
    }
  } else {
    throw new Error('Task has no inference model selected!')
  }

  return task
}

async function processFunctionTask(
  task: TaskNode,
  tools: Record<string, ToolBase | Tool>,
  taskWorkerController: TaskWorkerController,
) {
  if ('functionCall' in task.content) {
    const func = task.content.functionCall
    console.log(`Calling function ${func.name}`)
    if (tools[func.name] && !taskWorkerController.isInterrupted()) {
      const result = await handleFunctionExecution(func, tools, taskWorkerController.onInterrupt)
      task.result = result
    } else {
      const toolnames = JSON.stringify(task.allowedTools)
      throw new TaskProcessingError(
        !taskWorkerController.isInterrupted()
          ? `The function '${func.name}' is not available in tools. Please select a valid function from this list: ${toolnames}`
          : 'The function execution was cancelled by taskyon',
      )
    }
  }
  return task
}

function parseChatResponse2TaskDraft(message: string): Record<string, unknown> {
  // parse the response and create a new task filled with the correct parameters
  let yamlContent = message.trim()
  // Use exec() to find a match
  const yamlBlockRegex = /```(?:yaml|YAML|[^\n]*)\n?([\s\S]*?)\n?```/
  const yamlMatch = yamlBlockRegex.exec(yamlContent)
  if (yamlMatch && yamlMatch[1]) {
    yamlContent = yamlMatch[1] // Use the captured group
  }

  // TODO: if we haven't found anything,  search for anything that looks like yaml!!

  let parsedYaml: unknown = undefined
  try {
    // Parse the extracted or original YAML content
    parsedYaml = load(yamlContent)
    parsedYaml = normalizeFalsyValues(parsedYaml)
  } catch (err) {
    throw new TaskProcessingError('Error converting the response to yaml', {
      yamlString: yamlContent,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    })
  }
  /* TODO: this is currently too difficult for LLMs, so we are doing this manually
  which is a lot more robust. We try to keep structured responses as simple as possible
  const structuredResponseResult =
    await StructuredResponse.safeParseAsync(parsedYaml);

  if (!structuredResponseResult.success) {
    // TODO: as our object is completly partial, this never gets caled
    // right now..  do we `need` to have any checks here?
    throw new TaskProcessingError(
      'ZOD parse error: Unknown response object type:',
      structuredResponseResult.error.format(),
    );
  }*/
  if (parsedYaml !== null && typeof parsedYaml === 'object' && !Array.isArray(parsedYaml))
    return parsedYaml as Record<string, unknown>
  throw new TaskProcessingError('Parse Error:  the structured response must have keys and values!')
}

// we use this to decide whether we should call a function or to continue
// this is usually not needed if we use llmTools (like built-in tools from openai API)
function generateFollowupFromStructuredResponse(
  choice: ChatResponseType['choices'][0],
): Pick<partialTaskDraft, 'role' | 'content'>[][] {
  const structResponse = parseChatResponse2TaskDraft(choice.message.content || '')
  // depending on what role and tasktype the finishedTask has, we
  // expect different results from our structuredResponse
  // TODO: we need to do some plausibilitychecks here:
  //       - e.g. if use tool=true, but no command present
  // actually, it would be better to do this in the structreReponse processing ? :)

  // we immediatly generate a follow up response here based on the structResponse. This avoids
  // having to process it in another loop as we know the result already anyways.
  // the "structuredMessage" type is mainly there so that the LLM can see what it said :).
  // e.g. in case there is an error...
  // In fact we always decide right here, what we do *after* the structured response and simply add the
  // structured response as a normal "message" task to the chain...
  // this way we can put all the parsing logic & interpretation and all of this here. While
  // our tasks only have to process the actual data they are receiving
  const lowerStructResponse = keysToLowerCase(structResponse)
  const useTool =
    yesnoToBoolean(lowerStructResponse['use tool']) &&
    (!('try again' in lowerStructResponse) || yesnoToBoolean(lowerStructResponse['try again']))

  if (useTool) {
    console.log('trying to get tool call from structured response')
    const newTask: partialTaskDraft = {
      role: 'assistant',
      content: { structuredResponse: choice.message.content || '' },
    }

    // this doesn't say anything about whether the parameters are
    // chosen correctly for this function yet. It only says that
    // they are valid parameters for any function...
    let res = FunctionCall.safeParse(structResponse.command)
    if (res.error) {
      // try one more time using all lower case
      res = FunctionCall.safeParse(lowerStructResponse.command)
    }
    if (res.success) {
      const command = res.data
      // TODO:  this doesn't work!!  newTask doesn't have an ID yet and the next task can#t pick it up from there!!
      return [
        [
          newTask,
          {
            role: 'assistant',
            content: { functionCall: command },
          },
        ],
      ]
    } else {
      return [
        [
          newTask,
          {
            role: 'system',
            content: {
              message: `The response (${JSON.stringify(pickProperties(structResponse, ['use tool', 'try again']))})
 suggests we should use a tool, but we could not parse the ${JSON.stringify(structResponse.command)} property.`,
            },
          },
        ],
      ]
    }
  } else {
    // in the case that we don't call a tool, provide a "normal" answer :)
    // this time we declare it as "Open" and set execution to "true"
    return [
      [
        {
          role: 'assistant',
          content: { structuredResponse: choice.message.content || '' },
        },
      ],
    ]
  }
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
 *
  here is a chart of the relations & possible transitions between tasks:

- [Transition Map](/docs/conversations/taskyon_description)

```

 *
 *
 */

// TODO: make this function a lot mor eexplicit in that it represents our task transition map
// TODO: get rid of taskManager, if thats possible! :) I don#t see why we would need taskmanager in order to create
//       follow-up tasks?
// we return 2D list of tasks here..   each list represents a chain of linked tasks through priorID
async function generateFollowUpTasksFromResult(
  finishedTask: TaskNode,
  taskManager: TyTaskManager,
  llmTools: boolean = false,
): Promise<partialTaskDraft[][]> {
  console.log('generate follow up task')
  const useTyTools = finishedTask.allowedTools?.length ? true : false

  let newTasks: partialTaskDraft[][] = []
  // TODO: what do we do in case of an empty user message, but only a file?
  //       right now, we assume, that user message always comes after uploaded file message :)
  if (finishedTask.result) {
    if ('functionCall' in finishedTask.content) {
      newTasks = [
        [
          {
            role: 'system',
            content: { toolResult: finishedTask.result },
          },
        ],
      ]
    }
    // did we get any response from an LLM?
    // TODO: make this part of our new chatcompletion tool!
    const choice = getChatResponseFromTask(finishedTask)?.choices[0]
    if (choice) {
      // check if we have any functioncalls from the llm inference
      // in that case we shoud handle that first :)
      const functionCall = extractOpenAIFunctions(
        choice,
        await taskManager.updateToolDefinitions(true),
      )
      if (functionCall[0]) {
        // TODO: enable multiple parallel function calls
        newTasks = [
          [
            {
              role: 'function',
              content: { functionCall: functionCall[0] },
            },
          ],
        ]
      }
      if (!choice.message.content) {
        throw new TaskProcessingError('The response content from the AI was empty!', {
          choice,
        })
      }

      // so now we know there are no function calls indicated from the original service
      // so we can parse the structured response or simply get a reponse to a "normal"
      // chat message.
      if (
        (!llmTools &&
          (('message' in finishedTask.content && finishedTask.role === 'user' && useTyTools) || // this happens, if we use tools, but no LLM-builtin tools
            'toolResult' in finishedTask.content)) || // taskResult, but no LLM-builtin tools
        (finishedTask.role === 'system' && !('toolResult' in finishedTask.content)) // this happens e.g. in the case of an error...
      ) {
        newTasks = generateFollowupFromStructuredResponse(choice)
      } else {
        // if 'message' in finishedTask.content && finishedTask.role === 'assistant'
        // this is the final response, so we simply add it to the chain without executing it
        newTasks = [
          [
            {
              role: 'assistant',
              content: { message: choice.message.content },
            },
          ],
        ]
        console.log('No more follow up tasks!')
      }
    }
  }

  // augment newest tasks with debugging information
  // TODO: move this into a different data structure..
  // it would be good to not hav this inside the tasks themselves to imprive immutability
  newTasks.forEach((ts) =>
    ts.forEach((t) => {
      t.configuration = finishedTask.configuration
      t.debugging = {
        ...t.debugging,
        promptTokens: finishedTask.debugging.taskTokens,
        taskTokens: finishedTask.debugging.taskTokens,
        taskCosts: finishedTask.debugging.taskCosts,
      }
    }),
  )
  return newTasks
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
  let interrupted = true
  let interruptReason: string | null = null
  let interruptCallbacks: ((reason: string | null) => void)[] = []
  let waiting = false
  let errorCount = 0

  function interrupt(reason: string | null = null): void {
    console.log('interrupting: ', reason)
    interrupted = true
    interruptReason = reason
    interruptCallbacks.forEach((callback) => callback(reason))
  }

  function isWaiting() {
    return waiting
  }

  function setWaiting(value: boolean) {
    console.log('task worker is waiting!')
    waiting = value
  }

  function isInterrupted(): boolean {
    return interrupted
  }

  function getInterruptReason(): string | null {
    return interruptReason
  }

  function reset(full = true): void {
    interrupted = false
    interruptReason = null
    errorCount = 0
    if (full) {
      interruptCallbacks = []
    }
  }

  const onInterrupt: OnInterruptFunc = (callback) => {
    interruptCallbacks.push(callback)
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
      errorCount++
    },
    getErrorCount: () => {
      return errorCount
    },
  }
}
export type TaskWorkerController = ReturnType<typeof useTaskWorkerController>

async function processTask(
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
    },
    false,
  )

  const apiKey = llmSettings.selectedApi ? apiKeys[llmSettings.selectedApi] : undefined

  if (
    'message' in task.content ||
    'toolResult' in task.content ||
    'structuredResponse' in task.content
  ) {
    // TODO: get rid of "taskManager" in processChatTask
    // TODO: make this an "ordinary" function! :)

    if (!apiKey)
      throw new TaskProcessingError('We need to define an API key to process our chat Task!')

    task = await processChatTask(task, llmSettings, apiKey, taskManager, taskWorkerController)
  } else if ('functionCall' in task.content) {
    // calculate function result
    // in the case we don't have a result yet, wPe need to calculate it :)
    task = await processFunctionTask(
      task,
      await taskManager.updateToolDefinitions(false),
      taskWorkerController,
    )
  } else {
    throw new TaskProcessingError("We don't know how to process this task to get a result.")
  }

  // get token usage for this task..
  await addTaskCostInformation(task, taskManager, llmSettings, apiKey)

  return task
}

async function addTaskCostInformation(
  task: Readonly<TaskNode>,
  taskManager: TyTaskManager,
  llmSettings: llmSettings,
  apiKey?: string,
) {
  // TODO: also get cost information for other tasks, than chatCompletion ;)!
  const chatResponse = getChatResponseFromTask(task)
  if (chatResponse) {
    const { openAIConversationThread } = await generateCompleteChat(task, llmSettings, taskManager)

    // openai sends back the exact number of prompt tokens :)
    if (chatResponse.usage) {
      task.debugging.promptTokens = chatResponse.usage.prompt_tokens
      task.debugging.resultTokens = chatResponse.usage.completion_tokens
      task.debugging.taskTokens = chatResponse.usage.total_tokens
    }
    const allTools = await taskManager.updateToolDefinitions(true)
    task.debugging.estimatedTokens = await estimateChatTokens(
      // we are doing a deepCopy here in order to make sure we loose the^ reactivity...
      // TODO:  once our tasks are immutable and non-reactive, we can remove this..
      deepCopy(task),
      openAIConversationThread,
      allTools,
      chatResponse.choices[0]!.message.content ?? '',
    )

    // TODO: replace this below with a taskNode in lower hierachy which does this :)
    if (chatResponse && llmSettings.selectedApi === 'openrouter.ai' && apiKey) {
      console.log('getting openrouter generation info')
      void sleep(10000).then(() =>
        getOpenRouterGenerationInfo(
          chatResponse.id,
          generateHeaders(apiKey, llmSettings.siteUrl, llmSettings.selectedApi || ''),
        ).then((generationInfo) => enrichWithUsageInfos(task, taskManager, generationInfo)),
      )
    } else if (
      chatResponse &&
      llmSettings.selectedApi === 'taskyon' &&
      !chatResponse.model.endsWith(':free') &&
      apiKey &&
      !isTaskyonKey(apiKey, false)
    ) {
      const api = getApiConfigCopy(llmSettings, task.configuration?.chatApi)
      if (api) {
        console.log('getting taskyon generation info')
        // our backend tries to get the finished costs
        // after ~4000ms, so we wait for 6000 here...
        void sleep(6000).then(() =>
          getTaskyonCosts(llmSettings, apiKey, api, chatResponse.id, task.id).then(
            (generationInfo) => {
              console.log('taskyon generation info:', generationInfo)
              void enrichWithUsageInfos(task, taskManager, generationInfo)
            },
          ),
        )
      }
    }
  }
}

function getChatResponseFromTask(task: Readonly<TaskNode>) {
  const res = ChatResponseType.safeParse(task.result)
  return res.data
}

export async function runTaskWorker(
  processTasksQueue: AsyncQueue<string>,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController,
) {
  console.log('entering task worker loop...')

  const addTask2Tree = initAddTask2Tree(processTasksQueue, taskManager)

  while (true) {
    console.log('waiting for next task!')
    let task: TaskNode | undefined = undefined
    try {
      if (taskWorkerController.isInterrupted()) {
        // in case of errors, especially if its an interrupt event we simply want to cancel everything :P
        // empty our task queue :)
        console.log('clear out task queue due to interruption')
        processTasksQueue.clear()
      }

      if (processTasksQueue.count() === 0) {
        taskWorkerController.setWaiting(true)
      }
      const taskId = await processTasksQueue.pop()
      taskWorkerController.setWaiting(false)
      if (taskWorkerController.isInterrupted()) {
        // don't process tasks anymore..  all we can do now is to wait until the user manually presses the
        // "reset" button ;)
        continue
      }

      // make sure we know from outside that the worker is active...
      console.log('processing task:', taskId)
      task = await taskManager.getTask(taskId)
      if (task && !taskWorkerController.isInterrupted()) {
        task = await processTask(
          task,
          taskManager,
          taskId,
          llmSettings,
          apiKeys,
          taskWorkerController,
        )
        // create a new task form the result. E.g. in the case of a simple chat, this will
        // create a task with the Answer of the LLM which then gets displayed in the chatwindow...
        const newTasks = await generateFollowUpTasksFromResult(
          task,
          taskManager,
          llmSettings.enableOpenAiTools,
        )
        // we make sure to identify all parent tasks from this batch, because
        // we oly want to execute the leaf tasks..
        // we can do this, because all of these tasks are newly created. this means, we don't have any
        const addTasks = (finishedTask: TaskNode) => (ts: (typeof newTasks)[0]) => {
          const immediateExecute = taskWorkerController.isInterrupted() ? false : true
          ts.forEach((t) => {
            void addTask2Tree(t, t.priorID || finishedTask.id, immediateExecute)
          })
          // add last task to GUI
          llmSettings.selectedTaskId = newTaskId,
        }
        const taskAdder = addTasks(task)
        newTasks.forEach(taskAdder)

        // and finally save the task
        void taskManager.setTask(task, true)
      }
    } catch (error) {
      console.error('Could not complete task iteration:', error)
      taskWorkerController.increaseErrorCount()
      if (taskWorkerController.getErrorCount() >= llmSettings.maxAutonomousTasks) {
        taskWorkerController.interrupt(
          `Too many errors occured, interrupting execution after ${taskWorkerController.getErrorCount()} errors!`,
        )
      }

      const errorTask: partialTaskDraft = {
        role: 'system',
        configuration: task?.configuration,
        content: {
          message: `An error occured:\n\n\`\`\`\n${JSON.stringify(error)}\n\`\`\``,
        },
      }
      if (error instanceof TaskProcessingError) {
        errorTask.content = {
          //message: `An error occured: ${error.message}:\n\n${dump(error.details, { skipInvalid: true })}`,
          message: `An error occured:\n\n\`\`\`\n${error.message}${
            error.details ? ':\n\n' + JSON.stringify(makeSerializable(error.details, 7)) : ''
          }\n\`\`\``,
        }
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              name: error.name,
              details: error.details,
            },
          }
        }
      } else if (error instanceof Error) {
        errorTask.content = {
          message: `An error occured:\n\n\`\`\`\n${error.message}\n\n${JSON.stringify(error)}\n\`\`\``,
        }
        if (task) {
          task.debugging = {
            ...task.debugging,
            error: {
              message: error.message,
              stack: error.stack,
              location: 'task processing',
              cause: error.cause,
            },
          }
        }
      }

      const newTaskId = await addTask2Tree(
        errorTask,
        task?.id,
        // interrupt execution if interrupted flag is shown!
        // this makes sure that results are still saved, even if we stop any
        // further execution
        taskWorkerController.isInterrupted() ? false : true,
      )
      llmSettings.selectedTaskId = newTaskId

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
    return llmSettings.llmApis[llmSettings.selectedApi]
  }
}

function getApiConfigCopy(llmSettings: llmSettings, apiName?: string) {
  const searchName = apiName || llmSettings.selectedApi
  if (searchName) {
    const api = llmSettings.llmApis[searchName]
    return deepCopy(api)
  }
}
