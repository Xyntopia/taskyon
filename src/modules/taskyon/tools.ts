import { dump } from 'js-yaml'
import { bigIntToString } from '../utils'
import type {
  ToolResult,
  FunctionArguments,
  FunctionCall,
  ParamType,
  OnInterruptFunc,
} from './types'
import { TaskNode } from './types'
import { ToolBase, TaskProcessingError } from './types'
import type { RemoteFunctionResponse } from './iframeApiTypes'
import { RemoteFunctionCall, TaskyonMessages } from './iframeApiTypes'
import { z } from 'zod'
import type { YamlRepresentation } from '../zodUtils'
import { convertToYamlWComments } from '../zodUtils'
import { executeCodeInIframe } from './iframeWorker'

const toolContext = z
  .object({
    currentTask: TaskNode,
  })
  .describe('Context for tools which gives them access to other parts of the taskyon system')
export type toolContext = z.infer<typeof toolContext>

const internalToolFunctionSchema = z.custom<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (params: any, context: toolContext) => unknown // unknown also includes Promise<unknown>
>((val) => typeof val === 'function', {
  message: 'Expected a function that accepts any arguments and returns unknown or Promise<unknown>',
})
export type internalToolFunctionSchema = z.infer<typeof internalToolFunctionSchema>

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

const InternalTool = ToolBase.extend({
  function: internalToolFunctionSchema,
}).describe('Internal tool definition, which has access to the taskyon system')
export type InternalTool = z.infer<typeof InternalTool>

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
        const response = TaskyonMessages.safeParse(event.data)
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
  currentTask: TaskNode,
  // TODO: add taskManager here, so we can use it in the function execution
  //       we somehow also want to be able to do this with "dynamically" loaded tools
  //       but only, if they're declared "trusted" or something like that...
): Promise<ToolResult> {
  let funcR: unknown
  const tool = getTool(tools, func.name)
  if ('function' in tool && tool.function) {
    console.log('using tool!', tool)
    funcR = await tool.function(func.arguments, { currentTask })
    funcR = bigIntToString(funcR)
    return { result: dump(funcR) }
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool)
    try {
      // Execute code in iframe with parameters (func.arguments)
      funcR = await executeCodeInIframe(tool.code, func.arguments, func.name + '.js', onInterrupt)
      funcR = bigIntToString(funcR) // Optionally convert bigInt
      return { result: dump(funcR) }
    } catch (error) {
      throw new TaskProcessingError(
        `Error executing iframe code for tool: ${func.name}. Error: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  } else {
    // we do the zod object parsing/validation here, because we might have a proxy object from upstream
    // and want to make sure its serializable for a postMessage function.
    // TODO: use our "onInterrupt" here somehow ;)
    const funcR = await handleRemoteFunction(func.name, func.arguments)
    return { result: dump(funcR) }
  }
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
    const type = params.properties[key]?.type
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
        console.log(`No default value for parameter type: ${type}`)
        defaultParams[key] = null
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
  Object.entries(tool.parameters.properties).forEach(([key, param]) => {
    // Check if the key is in the list of required properties
    // const isRequired = requiredProperties.has(key);
    // If the property is required, use the key as is, otherwise add a "?" to the key
    if (param.description) {
      const descriptionKey = `# ${key} description`
      args[descriptionKey] = param.description.replace(/\n/g, ' ')
    }

    const argKey = key
    args[argKey] = param.type
  })

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
