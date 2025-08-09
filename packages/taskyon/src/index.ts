import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { InternalTool } from 'src/modules/taskyon/tools'
import type { FunctionCall, partialTaskDraft, toolContext } from 'src/modules/taskyon/types'

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
