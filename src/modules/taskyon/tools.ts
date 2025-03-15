import { dump } from 'js-yaml'
import { bigIntToString } from '../utils'
import type {
  FunctionArguments,
  FunctionCall,
  ParamType,
  OnInterruptFunc,
  WithRequired,
  TaskNode,
} from './types'
import { partialTaskDraft } from './types'
import { ToolBase, TaskProcessingError } from './types'
import type { RemoteFunctionResponse } from './iframeApiTypes'
import { RemoteFunctionCall, TaskyonMessage } from './iframeApiTypes'
import { z } from 'zod'
import type { YamlRepresentation } from '../zodUtils'
import { convertToYamlWComments } from '../zodUtils'
import { executeCodeInIframe } from './iframeWorker'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { JSONSchema7 } from 'json-schema'

const taskMarker = '*TY_TASKRESULT*'

export const taskResult = z.object({
  taskResultMarker: z
    .literal(taskMarker)
    .default(taskMarker)
    .describe(
      'we use this marker in order to indicate that the result should be added as new tasks!',
    ),
  taskChainList: z.array(z.array(partialTaskDraft)),
})
export type taskResult = z.infer<typeof taskResult>

export function makeTaskResult(tasks: partialTaskDraft[][]): taskResult {
  return {
    taskResultMarker: taskMarker,
    taskChainList: tasks,
  }
}

// the following doesn't really work ;) thats why we're doing the custom schema above..
/*const internalToolFunctionSchema = z
  .function()
  .args(z.record(z.string(), z.unknown()), toolContext)
  .returns(z.unknown())
  .describe('Function definition for internal tools with context')
export type internalToolFunctionSchema = z.infer<typeof internalToolFunctionSchema>
*/
/*z
    .function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.unknown())
    .describe('Simple function definition for internal tools'),*/

export type toolContext = {
  taskChain: TaskNode[]
  getSecret: (name: string) => Promise<string>
  setSecret: (name: string, value: string) => void
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
  function: internalToolFunctionSchema.optional(),
}).describe('Internal tool definition, which has access to the taskyon system')
export type InternalTool = z.infer<typeof InternalTool>

export type ClientTool = WithRequired<InternalTool, 'function'>

// Create a helper function to preserve schema types
export function createTool<T, SCHEMA extends JSONSchema, PARAMS = FromSchema<SCHEMA>>(
  tool: T & {
    parameters: SCHEMA & { readonly [key: string]: unknown }
    function?: (params: PARAMS, context: toolContext) => unknown
  } & Omit<InternalTool, 'function'>,
): T {
  return tool
}
// TODO: automatically type the FunctionCall correctly using the
//       json definition from a tool :)
export function createToolTask(f: FunctionCall): partialTaskDraft {
  return {
    role: 'function',
    name: f.name,
    content: {
      type: 'functioncall',
      data: f,
    },
  }
}

// This function executes code in a different browser context. E.g. executing a
// function in the context of the parent of an iframe!
// TODO: move this into our iframe API?
async function handleRemoteFunction(name: string, args: FunctionArguments) {
  // set up listener to listen for function call result.
  const funcRP: Promise<RemoteFunctionResponse> = new Promise((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      console.log('remoteHandler received message', event)
      // TODO: Add security checks here, e.g., verify event.origin
      if (event.source === window.parent && event.data) {
        const response = TaskyonMessage.safeParse(event.data)
        if (response.success) {
          if (response.data.type == 'functionResponse' && response.data.functionName === name) {
            window.removeEventListener('message', listener) // remove listener
            resolve(response.data)
          }
        } else {
          reject(
            new TaskProcessingError('The message had the wrong format for taskyon!', {
              error: response.error,
            }),
          )
        }
      }
    }

    // Set a timeout to reject the promise if no response is received within a certain time frame
    const timeoutSeconds = 10
    setTimeout(() => {
      reject(
        new TaskProcessingError(
          `Response timeout (${timeoutSeconds}). Waiting for function ${name} more than ${timeoutSeconds}s`,
        ),
      )
      window.removeEventListener('message', listener) // remove listener on timeout
    }, timeoutSeconds * 1000) // 100 seconds timeout for example

    // TODO: make timeout configurable
    window.addEventListener('message', listener)
  })

  // we do this also in order to make sure we have a defined object
  // which we can send through postMessage without any functions etc...
  const message = RemoteFunctionCall.parse({
    type: 'functionCall',
    functionName: name,
    arguments: args,
  })
  console.log('no tool code found, posting a function message to', message)
  // after we've set up the listener, initiate the function call
  window.parent.postMessage(message, '*') // TODO. Specify the exact origin instead of '*'

  const funcR = await funcRP
  return funcR.response
}

function getTool(tools: Record<string, ToolBase | InternalTool>, name: string) {
  const tool = tools[name]
  if (!tool) {
    throw new TaskProcessingError("Tool doesn't exist", {
      toolName: name,
    })
  }
  return tool
}

/**
 * Handle function execution for LLMs.
 * All errors of this function result in an error task in the main task worker!
 *
 *
 * @param func
 * @param tools
 * @param taskManager
 * @returns
 */
export async function handleFunctionExecution(
  func: FunctionCall,
  tools: Record<string, ToolBase | InternalTool>,
  onInterrupt: OnInterruptFunc,
  context: toolContext,
  // TODO: add taskManager here, so we can use it in the function execution
  //       we somehow also want to be able to do this with "dynamically" loaded tools
  //       but only, if they're declared "trusted" or something like that...
): Promise<unknown> {
  // TODO: test here, if tool parameters are correct according to json schema
  //       if not, throw an error message...
  let funcR: unknown
  const tool = getTool(tools, func.name)
  if ('function' in tool && tool.function) {
    console.log('using tool!', tool)
    // TODO: try longterm, to also execute the "internal" functions in iframe..
    //       maybe by being able to remove them all..
    funcR = await tool.function(func.arguments, context)
    funcR = bigIntToString(funcR)
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool)
    try {
      // TODO: add tool context to our "safe" functions as well..
      // Execute code in iframe with parameters (func.arguments)
      funcR = await executeCodeInIframe(tool.code, func.arguments, func.name + '.js', onInterrupt)
      funcR = bigIntToString(funcR) // Optionally convert bigInt
    } catch (error) {
      throw new TaskProcessingError(
        `Error executing iframe code for tool: ${func.name}. Error: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  } else {
    // we do the zod object parsing/validation here, because we might have a proxy object from upstream
    // and want to make sure its serializable for a postMessage function.
    // TODO: use our "onInterrupt" here somehow ;)
    // TODO: pass tool context here as well :)
    funcR = await handleRemoteFunction(func.name, func.arguments)
  }
  return funcR
}

/*function generateToolSummary() {
  return Object.keys(tools)
    .map((toolName) => {
      const { description } = tools[toolName];
      return `${toolName}: ${description}`;
    })
    .join('\n');
}*/

export function getDefaultParametersForTool(tool: InternalTool | ToolBase) {
  const params = tool.parameters
  if (!params || !params.properties) {
    console.log(`No parameters defined for tool ${tool.name}.`)
    return {}
  }

  const defaultParams: Record<string, ParamType> = {}
  Object.keys(params.properties).forEach((key) => {
    const property = params.properties![key]
    if (property && typeof property !== 'boolean' && 'type' in property) {
      const type = property.type
      // Assign a default value based on the parameter's type.
      switch (type) {
        case 'string':
          defaultParams[key] = '' // Default empty string
          break
        case 'number':
          defaultParams[key] = 0 // Default number zero
          break
        case 'boolean':
          defaultParams[key] = false // Default boolean false
          break
        case 'object':
          defaultParams[key] = {} // Default empty object
          break
        case 'array':
          defaultParams[key] = [] // Default empty array
          break
        // Add cases for any other types you expect
        default:
          console.log(`No default value for parameter type: ${JSON.stringify(type)}`)
          defaultParams[key] = null
      }
    }
  })

  return defaultParams
}

export interface WorkerMessage {
  success: boolean
  result?: unknown
  error?: string
}

function convertToToolCommandString(tool: ToolBase): string {
  // convert a tool into a schema which is compatible with toolCommandChat
  const args: YamlRepresentation = {}

  const requiredProperties = new Set(tool.parameters.required || [])

  // Loop over each property in the tool's parameters
  if (tool.parameters.properties) {
    Object.entries(tool.parameters.properties).forEach(([key, param]) => {
      // Check if the key is in the list of required properties
      // const isRequired = requiredProperties.has(key);
      // If the property is required, use the key as is, otherwise add a "?" to the key
      if (param && typeof param !== 'boolean' && 'description' in param) {
        const descriptionKey = `# ${key} description`
        args[descriptionKey] = param.description?.replace(/\n/g, ' ') ?? ''
      }

      if (param && typeof param === 'object' && 'type' in param) {
        const argKey = key

        // Handle enum types
        if (param.enum) {
          args[argKey] = `enum: ${(param.enum as string[]).join(', ')}`
        } else {
          // Handle other types
          args[argKey] = Array.isArray(param.type)
            ? param.type.map(String).join(', ')
            : String(param.type)
        }

        // Handle default values
        if ('default' in param) {
          args[`${argKey} default`] =
            typeof param.default === 'object'
              ? JSON.stringify(param.default)
              : String(param.default)
        }

        // Handle additional properties
        if ('minimum' in param) {
          args[`${argKey} minimum`] = String(param.minimum)
        }
        if ('maximum' in param) {
          args[`${argKey} maximum`] = String(param.maximum)
        }
        if ('pattern' in param) {
          args[`${argKey} pattern`] = String(param.pattern)
        }

        // Handle nested objects
        if (param.type === 'object' && param.properties) {
          Object.entries(param.properties).forEach(([nestedKey, nestedParam]) => {
            if (nestedParam && typeof nestedParam !== 'boolean' && 'type' in nestedParam) {
              const nestedArgKey = `${argKey}.${nestedKey}`
              args[nestedArgKey] = Array.isArray(nestedParam.type)
                ? nestedParam.type.map(String).join(', ')
                : String(nestedParam.type)
            }
          })
        }

        // Handle array items
        if (param.type === 'array' && param.items) {
          const itemsType =
            param.items && typeof param.items === 'object' && 'type' in param.items
              ? Array.isArray(param.items.type)
                ? param.items.type.map(String).join(', ')
                : String(param.items.type)
              : 'unknown'
          args[`${argKey} items`] = itemsType
        }
      }
    })
  }

  const argStrRaw = dump({
    'FUNCTION ARGUMENTS': args,
  })
  const argStr = convertToYamlWComments(argStrRaw)
  const cmdString = `NAME: ${tool.name}:
DESCRIPTION: ${tool.description.replace(/\n/g, ' ')}
${argStr}
REQUIRED: ${[...requiredProperties].join(', ')}`
  return cmdString
}

export function summarizeTools(toolIDs: string[], tools: Record<string, ToolBase>, short = false) {
  if (short) {
    const toolStr = toolIDs
      .map((t) => {
        const tool = getTool(tools, t)
        return `- ${tool.name}: ${tool.description}`
      })
      .join('\n')
    return toolStr
  } else {
    const toolStr = toolIDs
      .map((t) => {
        const tool = getTool(tools, t)
        const toolStr = convertToToolCommandString(tool)
        return toolStr
      })
      .join('\n---\n')

    return `-----\n${toolStr}\n-----`
  }
}

export function mapFunctionNames(toolNames: string[], tools: Record<string, ToolBase>): ToolBase[] {
  return toolNames?.map((t) => tools[t] as ToolBase).filter((t) => t)
}

export const exampleTool = createTool({
  name: 'myExampleStringAdderAlone',
  description: 'provide a short description which an AI can understand',
  longDescription: 'provide a long description if the AI/Human needs more details',
  parameters: {
    type: 'object',
    properties: {
      parameter1: {
        type: 'string',
        description: 'This is an example parameter!',
      },
      parameter2: {
        type: 'string',
        description: 'This is another example parameter, but not required!',
      },
    },
    required: ['parameter1'],
  },
  code: "({parameter1, parameter2 = 'default parameter :)'}) => {return parameter1 + ' ' + parameter2;}",
})

export async function craeteToolJsonSchema() {
  const { zodToJsonSchema } = await import('zod-to-json-schema')
  const JSON_SCHEMA_PLACEHOLDER: JSONSchema7 = {
    type: 'object',
    description:
      'A valid JSON Schema object defining the structure, types, and constraints for the tool parameters. Include properties, required fields, and any other validations as needed.',
  }

  // Function to convert Zod schema to JSON Schema dynamically
  const convertZodToJsonSchema = (schema: z.ZodTypeAny) => {
    return zodToJsonSchema(schema, {
      $refStrategy: 'none',
      definitionPath: '#/definitions',
    })
  }

  const toolBaseJsonSchema = convertZodToJsonSchema(ToolBase) as JSONSchema7 & {
    properties: Record<string, unknown>
  }
  if (toolBaseJsonSchema) {
    toolBaseJsonSchema.properties.parameters = JSON_SCHEMA_PLACEHOLDER
    delete (toolBaseJsonSchema as JSONSchema7).$schema
  }

  return toolBaseJsonSchema as JSONSchema7 & Record<string, unknown>
}
