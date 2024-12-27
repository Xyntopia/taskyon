import type OpenAI from 'openai'
import { callLLM } from '../taskyon/chat'
import { generateCompleteChat, generateOpenAIToolDeclarations } from '../taskyon/promptCreation'
import type { TyTaskManager } from '../taskyon/taskManager'
import type { TaskWorkerController } from '../taskyon/taskWorker'
import { getApiConfigCopy } from '../taskyon/taskWorker'
import type { TaskNode, llmSettings } from '../taskyon/types'
import type { Tool, TypedTool } from '../taskyon/tools'

// this function processes all tasks which go to any sort of an LLM

// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration

export async function processChatTask(
  task: TaskNode,
  configuration: { model: string; chatApi: string },
  llmSettings: llmSettings,
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  const api = getApiConfigCopy(llmSettings, configuration.chatApi)
  const apiKey = llmSettings.selectedApi ? apiKeys[llmSettings.selectedApi] : undefined

  if (!api) {
    throw new Error(`api doesn't exist! ${llmSettings.selectedApi || 'no api selected!'}`)
  }
  const selectedModel = configuration.model
  if (selectedModel) {
    api.selectedModel = selectedModel
    console.log('execute chat task!', task)
    //TODO: also do this, if we start the task "autonomously" in which we basically
    //      allow it to create new tasks...
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
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
        },
      )

      return chatCompletion
    }
  } else {
    throw new Error('Task has no inference model selected!')
  }
}

export function createChatCompletionTool(
  task: TaskNode,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  async function fetchChatCompletion({ prompt, model }: { prompt: string; model: string }) {
    return processChatTask(
      task,
      { model, chatApi: 'openai' },
      llmSettings,
      taskManager,
      taskWorkerController,
    )
  }

  const chatCompletion: TypedTool<typeof fetchChatCompletion> = {
    function: fetchChatCompletion,
    description: 'Generates a chat-based response using the OpenAI API.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.`,
    name: 'chatCompletion',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The input text or conversation history to generate a response from.',
        },
        model: {
          type: 'string',
          description:
            'The name of the model to use for the completion. The default is "auto" if parameter is not used. A model will automatically be chosen for the task',
          default: 'auto',
        },
      },
      required: ['prompt'],
    },
  }

  return chatCompletion
}

export type chatCompletionTool = ReturnType<typeof createChatCompletionTool>
