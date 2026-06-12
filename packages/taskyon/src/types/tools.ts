import z from 'zod'
import { JSONSchema7 } from '../utils/jsonSchema'

export const taskMarker = '*TY_TASKRESULT*'

const FunctionName = z.string().refine((val) => /^[a-zA-Z0-9_-]+$/.test(val), {
  error: ({ input }) => {
    const msg = typeof input === 'string' ? input : JSON.stringify(input)
    return `The function/tool name ${msg} contains illegal characters. It has to fulfill '^[a-zA-Z0-9_-]+$'`
  },
})
type FunctionName = z.infer<typeof FunctionName>

export const ParamType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
  // We are also allowing undefined calls to the functions, even though this is not allowed in jsonschema.
  // But we are sometimes calling our functions manually and this way we can also call them without parameters.
  z.undefined(),
])
export type ParamType = z.infer<typeof ParamType>
export const FunctionArguments = z.record(z.string(), ParamType).meta({
  description: 'arguments of the function',
})
export type FunctionArguments = z.infer<typeof FunctionArguments>

/* here we are essentiall declaring the taskyon API */
export const FunctionCall = z.object({
  name: FunctionName,
  arguments: FunctionArguments,
})
export type FunctionCall = z.infer<typeof FunctionCall>

export const ToolBase = z.object({
  description: z.string().meta({
    description: 'A short description about the tool so that an LLM knows when to use it.',
  }),
  longDescription: z.string().optional().meta({
    description: 'An optional longer description for more complicated operations with this tool.',
  }),
  name: FunctionName.meta({
    description: 'Name of the tool. Has to fulfill: /^[a-zA-Z0-9_-]+$/',
  }),
  renderOptions: z
    .object({
      hideChat: z
        .boolean()
        .describe(
          "hide the tool in the UI chat. Useful if the function is used very often and we don't want it to clutter the chatWindow",
        ),
      hideLlm: z
        .boolean()
        .describe(
          'HideLlm will hide the  tool from an LLM inside chatCompletion. This is mainly useful for tools like "chatCompletion" which the llm doesn\'t need to see in the chatCompletion.',
        ),
      hideVector: z
        .boolean()
        .describe(
          'Whether the tool should be embedded and searchable by vector search. Only relevant if you are using vector search in your task chains.',
        ),
    })
    .partial()
    .optional(),
  parameters: JSONSchema7.meta({
    description: 'A JSON schema object describing the parameters of the function.',
  }).readonly(),
  code: z
    .string()
    .optional()
    .describe(
      `The functionality of the tool as javascript code. If a function description doesn't include any code,
Taskyon will automatically call a postMessage event with the parameters to the parent window
with the function name.`,
    ),
})
export type ToolBase = z.infer<typeof ToolBase> // this reflects json schema:  https://json-schema.org/specification-links
