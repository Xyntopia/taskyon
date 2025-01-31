import type { TyTaskManager } from '../taskyon/taskManager'
import { type TaskWorkerController } from '../taskyon/taskWorker'
import { TaskProcessingError, type llmSettings } from '../taskyon/types'
import {
  makeTaskResult,
  type InternalTool,
  type internalToolFunctionSchema,
  type toolContext,
} from '../taskyon/tools'

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
    renderOptions: { hideLlm: true },
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
