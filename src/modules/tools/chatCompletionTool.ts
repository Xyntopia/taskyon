import type OpenAI from 'openai'
import { callLLM } from '../taskyon/chat'
import { generateCompleteChat, generateOpenAIToolDeclarations } from '../taskyon/promptCreation'
import type { TyTaskManager } from '../taskyon/taskManager'
import type { TaskWorkerController } from '../taskyon/taskWorker'
import { getApiConfigCopy } from '../taskyon/taskWorker'
import type { TaskNode, llmSettings } from '../taskyon/types'

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
        },
      )

      return chatCompletion
    }
  } else {
    throw new Error('Task has no inference model selected!')
  }
}
