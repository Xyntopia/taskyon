import { dump } from 'js-yaml'
import { bigIntToString } from '../utils'
import type { FunctionArguments, FunctionCall, ParamType, WithRequired, toolContext } from './types'
import { convertZodToJsonSchemaCached, partialTaskDraft, taskMarker } from './types'
import { ToolBase } from './types'
import type { RemoteFunctionResponse } from './iframeApiTypes'
import { RemoteFunctionCall, TaskyonMessage } from './iframeApiTypes'
import { z } from 'zod'
import type { YamlRepresentation } from '../yamlUtils'
import { convertToYamlWComments } from '../yamlUtils'
import { executeCodeInIframe } from './iframeWorker'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { JSONSchema7, JSONSchema7Object } from 'json-schema'
import type { AnySchema, JSONSchemaType, ValidateFunction } from 'ajv'
import Ajv from 'ajv'

export const taskResult = z.object({
  taskResultMarker: z.literal(taskMarker).default(taskMarker).meta({
    description:
      'we use this marker in order to indicate that the result should be added as new tasks!',
  }),
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
  .meta({
    description: 'Function definition for internal tools with context',
  })
export type internalToolFunctionSchema = z.infer<typeof internalToolFunctionSchema>
*/
/*z
    .function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.unknown())
    .meta({
      description: 'Simple function definition for internal tools',
    }),*/

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
            new Error('The message had the wrong format for taskyon!', {
              cause: response.error,
            }),
          )
        }
      }
    }

    // Set a timeout to reject the promise if no response is received within a certain time frame
    const timeoutSeconds = 10
    setTimeout(() => {
      reject(
        new Error(
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
    throw new Error(`Tool doesn't exist: "${name}"`)
  }
  return tool
}

/**
 * Generate an object populated with all defaults from the provided JSON Schema.
 *
 * @param schema - A JSON Schema (with `default` fields on its properties).
 * @returns A fresh object with all defaults applied.
 */
export async function createWithDefaults<T>(schema: JSONSchemaType<T> | JSONSchema7): Promise<T> {
  const Ajv = await import(
    /* webpackPrefetch: true */
    /* webpackChunkName: "codemirror" */
    /* webpackMode: "lazy" */
    /* webpackFetchPriority: "low" */
    'ajv'
  )

  const ajv = new Ajv.default({ useDefaults: true })

  // Compile (or reuse) a validator that applies defaults
  const validate: ValidateFunction<T> = ajv.compile<T>(schema as unknown as AnySchema)

  // Start from an empty object; AJV will inject defaults into it
  const result = {} as T
  validate(result)
  return result
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
  tool: InternalTool,
  stopSignal: AbortSignal,
  context: toolContext,
  // TODO: add taskManager here, so we can use it in the function execution
  //       we somehow also want to be able to do this with "dynamically" loaded tools
  //       but only, if they're declared "trusted" or something like that...
): Promise<unknown> {
  // TODO: test here, if tool parameters are correct according to json schema
  //       if not, throw an error message...
  let funcR: unknown
  const toolDefaultParams = await createWithDefaults(tool.parameters)
  // mix in with explicit parameters
  if (typeof func.arguments === 'object' && func.arguments !== null) {
    func.arguments = {
      ...toolDefaultParams,
      ...func.arguments,
    } as FunctionArguments
  }
  console.log(toolDefaultParams)
  if (tool.function) {
    console.log('using tool!', tool)
    // TODO: try longterm, to also execute the "internal" functions in iframe..
    //       maybe by being able to remove all dependencies to taskyon lib? maybe by
    //       using the taskyon iframe api also inside iframe towards the parent?
    funcR = await tool.function(func.arguments, context)
    // TODO: what do we do for tools which have "code" but no id??,
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool)
    try {
      // TODO: add tool context to our "safe" functions as well..
      // Execute code in iframe with parameters (func.arguments)
      funcR = await executeCodeInIframe(
        tool.code,
        { params: func.arguments, context },
        func.name + '.js',
        stopSignal,
      )
    } catch (error) {
      throw new Error(`Error executing iframe code for tool: ${func.name}`, { cause: error })
    }
  } else {
    // we do the zod object parsing/validation here, because we might have a proxy object from upstream
    // and want to make sure its serializable for a postMessage function.
    // TODO: use our "onInterrupt" here somehow ;)
    // TODO: pass tool context here as well :)
    // TODO: right now, this also serves as a fallback for any tool whch doesn't define
    //       code or function..  this works even, if the tool isn't defined in our tool list!
    funcR = await handleRemoteFunction(func.name, func.arguments)
  }
  funcR = bigIntToString(funcR) // Optionally convert bigInt

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

  const ajv = new Ajv({ useDefaults: true })
  const schema = {
    type: 'object',
    properties: params.properties,
    required: params.required || [],
  }

  const validate = ajv.compile(schema)
  const defaultParams = {} as Record<string, ParamType>

  // Validate an empty object to populate it with defaults
  validate(defaultParams)

  return defaultParams
}

export interface WorkerMessage {
  success: boolean
  result?: unknown
  error?: string
}

function convertToToolCommandString(tool: ToolBase, longDescription = false): string {
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
  const toolDescription =
    longDescription && tool.longDescription ? tool.longDescription : tool.description
  const cmdString = `NAME: ${tool.name}
DESCRIPTION: ${toolDescription.replace(/\n/g, ' ')}
${argStr}
${requiredProperties.size > 0 ? `REQUIRED: ${[...requiredProperties].join(', ')}` : ''}`
  return cmdString
}

export function summarizeTools(
  toolIDs: string[],
  tools: Record<string, ToolBase>,
  short = false,
  longDescription = false,
) {
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
        const toolStr = convertToToolCommandString(tool, longDescription)
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

export function craeteToolJsonSchema() {
  const JSON_SCHEMA_PLACEHOLDER = {
    type: 'object',
    description:
      'A valid JSON Schema object defining the structure, types, and constraints for the tool parameters. Include properties, required fields, and any other validations as needed.',
  }

  const toolBaseJsonSchema = convertZodToJsonSchemaCached(ToolBase, {
    unrepresentable: 'any',
  }) as JSONSchema7Object
  if (
    toolBaseJsonSchema.properties &&
    typeof toolBaseJsonSchema.properties === 'object' &&
    !Array.isArray(toolBaseJsonSchema.properties)
  ) {
    toolBaseJsonSchema.properties.parameters = JSON_SCHEMA_PLACEHOLDER
    delete (toolBaseJsonSchema as JSONSchema7).$schema
  }

  return toolBaseJsonSchema as JSONSchema7 & Record<string, unknown>
}
