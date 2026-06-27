import type { JSONSchema, FromSchema } from 'json-schema-to-ts'
import z from 'zod'
import type { WithRequired } from '../utils/tsHelpers'
import { partialTaskDraft, type TaskNode } from './taskNode'
import type { FunctionCall } from './tools'
import { ToolBase, taskMarker } from './tools'

/**
 * Represents the context passed to tools within the Taskyon system.
 *
 * @property getExecutionTaskChain - Lazily retrieves the current execution task chain.
 * @property getSecret - Retrieves a secret value by name. If `askNew` is `true`, prompts for a new secret if it doesn't exist.
 *   If `askNew` is a string, uses the string as a custom message or hint when prompting for the secret.
 * @param name - The name of the secret to retrieve.
 * @param askNew - If `true`, prompts for a new secret if not found. If a string, uses it as a hint or message when prompting.
 * @returns A promise resolving to the secret value, or `undefined` if not found.
 *
 * @property setSecret - Stores a secret value by name.
 * @param name - The name of the secret to store.
 * @param value - The secret value to store.
 * @returns A promise that resolves when the secret is stored.
 * @property stopSignal - An AbortSignal that can be used to detect if the tool should stop execution.
 * @property toolId - The unique identifier for the tool instance.
 */
export type toolContext = {
  getExecutionTaskChain: () => Promise<TaskNode[]>
  createSubtasksResult: typeof createSubtasksResult
  getSecret: (name: string, askNew: boolean | string, saveNew?: boolean) => Promise<string | null>
  setSecret: (name: string, value: string) => Promise<void>
  stopSignal: AbortSignal
  toolId: string
  messagePort?: MessagePort // optional message port for communication
}

// TODO: make all of this generic functions in order to get better typescript checking
const internalToolFunctionSchema = z.custom<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (params: any, context: toolContext) => unknown // unknown also includes Promise<unknown>
>((val) => typeof val === 'function', {
  message: 'Expected a function that accepts any arguments and returns unknown or Promise<unknown>',
})
export type internalToolFunctionSchema = z.infer<typeof internalToolFunctionSchema>

const InternalTool = ToolBase.extend({
  // TODO: take away he "optional" from this type here...
  function: internalToolFunctionSchema.optional(),
}).meta({
  description: 'Internal tool definition, which has access to the taskyon system',
})
export type InternalTool = z.infer<typeof InternalTool>

export type ClientTool = WithRequired<InternalTool, 'function'>

// Create a helper function to preserve schema types
export function createTool<
  T,
  SCHEMA extends Readonly<JSONSchema>,
  PARAMS = FromSchema<SCHEMA, { keepDefaultedPropertiesOptional: true }>,
>(
  tool: T & {
    parameters: SCHEMA
    function?: (params: PARAMS, context: toolContext) => unknown
  } & Omit<InternalTool, 'function' | 'parameters'>,
): T {
  console.log('create tool', tool.name)
  return tool
}

// TODO: automatically type the FunctionCall correctly using the
//       json definition from a tool :)
export function toolCall<T extends FunctionCall['arguments']>(
  f: { arguments: T } & FunctionCall,
): partialTaskDraft & { content: { type: 'functioncall'; data: FunctionCall } } {
  return {
    role: 'function',
    content: {
      type: 'functioncall',
      data: f,
    },
  }
}

export const taskResult = z.object({
  taskResultMarker: z.literal(taskMarker).default(taskMarker).meta({
    description:
      'we use this marker in order to indicate that the result should be added as new tasks!',
  }),
  taskChainList: z.array(z.array(partialTaskDraft)),
})
export type taskResult = z.infer<typeof taskResult>

export const createSubtasksResult = (
  tasks: partialTaskDraft | partialTaskDraft[] | partialTaskDraft[][],
): taskResult =>
  taskResult.parse({
    taskResultMarker: taskMarker,
    taskChainList: Array.isArray(tasks) ? (Array.isArray(tasks[0]) ? tasks : [tasks]) : [[tasks]],
  })
