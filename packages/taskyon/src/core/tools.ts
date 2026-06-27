import Ajv from 'ajv'
import type { JSONSchema7, JSONSchema7Object, JSONSchema7Type } from 'json-schema'
import type { InternalTool } from '../types/toolApi'
import type { ParamType } from '../types/tools'
import { ToolBase } from '../types/tools'
import { convertZodToJsonSchemaCached } from '../utils/schema'
import { jsonSchemaToYamlString } from '../utils/yamlUtils'

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
