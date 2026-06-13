import type { Port } from '@taskyon/shared/modules/frpBus'
import Ajv from 'ajv'
import type { JSONSchema7, JSONSchema7Object, JSONSchema7Type } from 'json-schema'
import type { ReadonlyDeep } from 'type-fest'
import {
  REMOTE_FUNCTION_TIMEOUT_MS,
  RemoteFunctionCall,
  RemoteFunctionResponse,
} from '../types/messages'
import type { InternalTool, toolContext } from '../types/toolApi'
import type { FunctionArguments, FunctionCall, ParamType } from '../types/tools'
import { ToolBase } from '../types/tools'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox'
import { bigIntToString } from '../utils/objHelpers'
import { convertZodToJsonSchemaCached } from '../utils/schema'
import { jsonSchemaToYamlString } from '../utils/yamlUtils'

export type RemoteFunctionPort = Port<RemoteFunctionCall, RemoteFunctionResponse>

let remoteFunctionRequestCounter = 0

const createRemoteFunctionRequestId = (name: string) =>
  `${name}-${Date.now()}-${remoteFunctionRequestCounter++}`

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
  args: ReadonlyDeep<FunctionArguments>,
  duplexPort: RemoteFunctionPort,
) {
  const requestId = createRemoteFunctionRequestId(name)
  const funcRP: Promise<RemoteFunctionResponse> = new Promise((resolve, reject) => {
    let settled = false
    let unsub = () => {}

    const cleanup = () => {
      clearTimeout(timeout)
      unsub()
    }

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new Error(
          `Remote function bridge timed out after ${REMOTE_FUNCTION_TIMEOUT_MS}ms while waiting for ${name} (request ${requestId})`,
        ),
      )
    }, REMOTE_FUNCTION_TIMEOUT_MS)

    const listener = (msg: RemoteFunctionResponse) => {
      const response = RemoteFunctionResponse.safeParse(msg)
      if (response.success) {
        if (response.data.requestId === requestId) {
          if (settled) return
          settled = true
          cleanup()
          if (response.data.error) {
            let errorMessage = 'Unknown error'
            if (typeof response.data.error === 'string') {
              errorMessage = response.data.error
            } else {
              try {
                errorMessage = JSON.stringify(response.data.error) ?? errorMessage
              } catch {
                errorMessage = 'Non-serializable error'
              }
            }
            reject(
              new Error(`Remote function ${name} failed for request ${requestId}: ${errorMessage}`),
            )
            return
          }

          resolve(response.data)
        }
      } else {
        console.warn('Not a valid remote function message', response.error, msg)
      }
    }

    unsub = duplexPort.receive(listener)
  })

  // we do this also in order to make sure we have a defined object

  // which we can send through postMessage without any functions etc...
  const message = RemoteFunctionCall.parse({
    type: 'functionCall',
    functionName: name,
    requestId,
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
export function createWithDefaults(schema: JSONSchema7Type | JSONSchema7) {
  const ajv = new Ajv({ useDefaults: true })

  // Compile (or reuse) a validator that applies defaults
  const validate = ajv.compile(schema as object)

  // Start from an empty object; AJV will inject defaults into it
  const result = {}
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
  func: ReadonlyDeep<FunctionCall>,
  tool: InternalTool,
  stopSignal: AbortSignal, // add this to our duplexPort!!
  context: toolContext,
  // TODO: use the duplexPort for remote functions also for our "local" iframeworker execution?....
  duplexPort: RemoteFunctionPort,
): Promise<unknown> {
  // TODO: test here, if tool parameters are correct according to json schema
  //       if not, throw an error message...
  let funcR: unknown
  // We intentionally do not reject tool invocations here based on schema validation.
  // Taskyon should be tolerant at execution time and let the concrete tool implementation
  // decide whether partially-valid or loosely-shaped arguments are still usable.
  // This gives LLM-produced calls more room to succeed with small deviations.

  if (tool.function) {
    console.log('using tool!', tool.name)
    // TODO: try long-term, to get rid of "internal" functions.. not yet sure how to do this..
    //       maybe have tools with privileged access?
    funcR = await tool.function(func.arguments, context)
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool.name)
    try {
      //const { messagePort, ...modContext } = context
      //console.log('messagePort', messagePort)
      funcR = await executeToolInWorkerSandbox(
        tool.code,
        { params: func.arguments, context: context },
        func.name + '.js',
        stopSignal,
      )
    } catch (error) {
      throw new Error(`Error executing worker sandbox code for tool: ${func.name}`, {
        cause: error,
      })
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

  // Omit "parameters" from the Zod schema before converting to JSON Schema
  const toolBaseJsonSchema = convertZodToJsonSchemaCached(ToolBase.omit({ parameters: true }), {
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
