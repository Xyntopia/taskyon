import type OpenAI from 'openai'
import { callLLM } from '../taskyon/chat'
import { generateCompleteChat, generateOpenAIToolDeclarations } from '../taskyon/promptCreation'
import type { TyTaskManager } from '../taskyon/taskManager'
import { type TaskWorkerController } from '../taskyon/taskWorker'
import type { partialTaskDraft } from '../taskyon/types'
import { getApiConfigCopy } from '../taskyon/types'
import { TaskProcessingError, type TaskNode, type llmSettings } from '../taskyon/types'
import {
  makeTaskResult,
  type InternalTool,
  type internalToolFunctionSchema,
  type toolContext,
} from '../taskyon/tools'

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
              error: `The response (${JSON.stringify(pickProperties(structResponse, ['use tool', 'try again']))})
 suggests we should use a tool, but we could not parse the ${JSON.stringify(structResponse.command)} property.`,
            },
          },
        ],
      ]
    }
  } else {
    // in the case that we don't call a tool anymore, we simply return the structuredResponse
    // in the next step, this will generate a "normal" response from the AI.
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
 *
 *
 * here is a chart of the relations & possible transitions between tasks:
 *
 * - [Transition Map](/docs/conversations/taskyon_description)
 *
 *
 */
// TODO: make this function a lot mor eexplicit in that it represents our task transition map
// TODO: get rid of taskManager, if thats possible! :) I don#t see why we would need taskmanager in order to create
//       follow-up tasks?
// we return 2D list of tasks here..   each list represents a chain of linked tasks through priorID
// TODO:  move all of this function into its own Tool as well! this would be our "planner" tool/function :)
//        this tool would analyze the results of the previous function and create new tasks!
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

  // did we get any response from an LLM?
  // TODO: make this part of our new chatcompletion tool!rif of all of this?
  //       or we could also put this into a generic Taskplanner tool...
  const choice = getChatResponseFromResult(result)?.choices[0]
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
          // this functionCall will be executed in the next step, so we don't need any additional tasks here
          {
            role: 'function',
            content: { functionCall: functionCall[0] },
          },
        ],
      ]
    } else if (!choice.message.content) {
      newTasks = [
        [
          {
            role: 'system',
            content: { error: 'The response content from the AI was empty!' },
          },
          createChatCompletionTask(model),
        ],
      ]
    } else if (
      // so now we know there are no function calls indicated from the original service
      // so we can parse the structured response or simply get a reponse to a "normal"
      // chat message.
      (!llmTools &&
        (('message' in finishedTask.content && finishedTask.role === 'user' && useTyTools) || // this happens, if we use tools, but no LLM-builtin tools
          'toolResult' in finishedTask.content)) || // taskResult, but no LLM-builtin tools
      (finishedTask.role === 'system' && !('toolResult' in finishedTask.content)) // this happens e.g. in the case of an error...
    ) {
      // TODO: move the followup ask generation into a separate task/function! :)
      newTasks = generateFollowupFromStructuredResponse(choice)
    } else {
      // if 'message' in finishedTask.content && finishedTask.role === 'assistant'
      // this is the final response. These will not get added to the task queue and evaluated..
      newTasks = [
        [
          {
            role: 'assistant',
            content: { message: choice.message.content || '' },
          },
          {
            role: 'system',
            content: { termination: 'assistant answered' },
          },
        ],
      ]
      console.log('No more follow up tasks!')
    }
  }

  // augment newest tasks with debugging information
  // TODO: move this into a different data structure..
  // it would be good to not hav this inside the tasks themselves to imprive immutability
  newTasks.forEach((ts) =>
    ts.forEach((t) => {
      t.allowedTools = finishedTask.allowedTools
      t.debugging = {
        ...t.debugging,
        rawInput: result,
        promptTokens: finishedTask.debugging.taskTokens,
        taskTokens: finishedTask.debugging.taskTokens,
        taskCosts: finishedTask.debugging.taskCosts,
      }
    }),
  )
  return newTasks
}

// this function processes all tasks which go to any sort of an LLM

// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration
export function createTaskPlannerTool(
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  apiKeys: { [key: string]: string },
): InternalTool {
  const taskPlanner: internalToolFunctionSchema = async (
    { allowedTools }: { allowedTools: string[] },
    context: toolContext,
  ) => {
    if (!context.currentTask) {
      throw new Error(`No current task found!`)
    }
    if (!llmSettings.selectedApi) {
      throw new TaskProcessingError('No API selected!')
    }
    const newTasks = await generateFollowUpTasksFromResult(context.currentTask, taskManager, true)
    return makeTaskResult(newTasks)
  }

  // TODO: update short & long description so that an LLM AI can use this tool
  const taskPlannerTool: InternalTool = {
    function: taskPlanner,
    description: 'Generates a chat-based response using the OpenAI API.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.`,
    name: 'chatCompletion',
    renderOptions: { chatWindow: false, llm: false },
    parameters: {
      type: 'object',
      properties: {
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'A list of tools that the LLM can use.',
          default: [],
        },
      },
      required: [],
    },
  }

  return taskPlannerTool
}

export type chatCompletionTool = ReturnType<typeof createTaskPlannerTool>
