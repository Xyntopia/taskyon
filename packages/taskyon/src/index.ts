import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { FunctionCall, partialTaskDraft, toolContext } from 'src/modules/taskyon/types'
import z from 'zod'

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
export function createTool<T, SCHEMA extends Readonly<JSONSchema>, PARAMS = FromSchema<SCHEMA>>(
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
export function toolCall(
  f: FunctionCall,
): partialTaskDraft & { content: { type: 'functioncall'; data: FunctionCall } } {
  return {
    role: 'function',
    name: f.name,
    content: {
      type: 'functioncall',
      data: f,
    },
  }
}
