import { bigIntToString } from '../utils'
import type { FunctionArguments, FunctionCall, ParamType, toolContext } from './types'
import { convertZodToJsonSchemaCached, partialTaskDraft, taskMarker } from './types'
import { ToolBase } from './types'
import type { TaskWorkerMessage, TaskyonMessage } from './apiTypes'
import { RemoteFunctionResponse, RemoteFunctionCall } from './apiTypes'
import { z } from 'zod'
import { jsonSchemaToYamlString } from '../yamlUtils'
import { executeCodeInIframe } from './iframeWorker'
import type { JSONSchema7, JSONSchema7Object } from 'json-schema'
import type { AnySchema, JSONSchemaType, ValidateFunction } from 'ajv'
import Ajv from 'ajv'
import type { Port } from '../frpBus'
import type { WithRequired } from './tsHelpers'

export const taskResult = z.object({
  taskResultMarker: z.literal(taskMarker).default(taskMarker).meta({
    description:
      'we use this marker in order to indicate that the result should be added as new tasks!',
  }),
  taskChainList: z.array(z.array(partialTaskDraft)),
})
export type taskResult = z.infer<typeof taskResult>

export function makeTaskResult(
  tasks: partialTaskDraft | partialTaskDraft[] | partialTaskDraft[][],
): taskResult {
  let tasksArray: partialTaskDraft[][]
  if (Array.isArray(tasks)) {
    if (Array.isArray(tasks[0])) {
      // Already a 2D array
      tasksArray = tasks as partialTaskDraft[][]
    } else {
      // 1D array, wrap in another array
      tasksArray = [tasks as partialTaskDraft[]]
    }
  } else {
    // 0D, wrap in 2D array
    tasksArray = [[tasks]]
  }
  tasks = tasksArray
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

// This function executes code in a different browser context. E.g. executing a
// function in the context of the parent of an iframe!
// TODO: move this into our iframe API?
async function handleRemoteFunction(
  name: string,
  args: FunctionArguments,
  duplexPort: Port<TaskyonMessage, TaskWorkerMessage>,
) {
  const funcRP: Promise<RemoteFunctionResponse> = new Promise((resolve, reject) => {
    const listener = (msg: RemoteFunctionCall | RemoteFunctionResponse) => {
      console.log('remote function handler received message', msg)
      const response = RemoteFunctionResponse.safeParse(msg)
      if (response.success) {
        if (response.data.functionName === name) {
          unsub()
          if (response.data.error) reject(new Error('Remote function error:', response.data.error))
          resolve(response.data)
        }
      } else {
        console.warn('Not a valid remote function message', response.error, msg)
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
      unsub()
    }, timeoutSeconds * 1000) // 100 seconds timeout for example
    const unsub = duplexPort.receive(listener)
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
  duplexPort.send(message)

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
  stopSignal: AbortSignal, // add this to our duplexPort!!
  context: toolContext,
  duplexPort: Port<TaskyonMessage, TaskWorkerMessage>,
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
    // TODO: try longterm, to get rid of "internal" functions.. not yet sure how to do this..
    //       maybe have tools with privileged access?
    funcR = await tool.function(func.arguments, context)
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool)
    try {
      //const { messagePort, ...modContext } = context
      //console.log('messagePort', messagePort)
      funcR = await executeCodeInIframe(
        tool.code,
        { params: func.arguments, context: context },
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
    funcR = await handleRemoteFunction(func.name, func.arguments, duplexPort)
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
  const args = jsonSchemaToYamlString(tool.parameters)
  const toolDescription =
    longDescription && tool.longDescription ? tool.longDescription : tool.description
  const cmdString = `NAME: ${tool.name}
DESCRIPTION: ${toolDescription.replace(/\n/g, ' ')}
PARAMETERS:
${args}
`
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
