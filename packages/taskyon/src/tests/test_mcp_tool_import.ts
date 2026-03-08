import { createTaskNode } from '../core/createTasks'
import { ToolBase } from '../types/tools'
import type { JSONSchema7 } from '../utils/jsonSchema'

type CelestialMcpTool = {
  name: string
  description: string
  inputSchema: Readonly<JSONSchema7>
}

const celestialNodeExample: CelestialMcpTool = {
  // based on CelestialNode's MCP concept (space data lookups)
  name: 'search_asteroids',
  description: 'Search near-earth objects by date range and optional diameter filters.',
  inputSchema: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date (YYYY-MM-DD)',
      },
      end_date: {
        type: 'string',
        description: 'End date (YYYY-MM-DD)',
      },
      min_diameter_km: {
        type: 'number',
        description: 'Optional minimum diameter in kilometers.',
      },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
  },
}

function mapMcpToolToTaskyonTool(input: CelestialMcpTool) {
  return ToolBase.strict().parse({
    name: input.name,
    description: input.description,
    longDescription:
      'Imported from an MCP-style tool definition (CelestialNode-like space data endpoint).',
    parameters: input.inputSchema,
  })
}

function assertToolDefinitionTaskShape(task: Awaited<ReturnType<typeof createTaskNode>>) {
  if (task.content.type !== 'tooldefinition') {
    throw new Error(`Expected content.type=tooldefinition, got ${task.content.type}`)
  }
  if (task.content.data.name !== celestialNodeExample.name) {
    throw new Error(`Expected tool name ${celestialNodeExample.name}, got ${task.content.data.name}`)
  }
}

export const testAddCelestialNodeMcpTool = async () => {
  const mappedTool = mapMcpToolToTaskyonTool(celestialNodeExample)
  const task = await createTaskNode({
    role: 'user',
    content: {
      type: 'tooldefinition',
      data: mappedTool,
    },
  })
  assertToolDefinitionTaskShape(task)

  return {
    importedFrom: 'CelestialNode MCP (schema-based example)',
    toolName: mappedTool.name,
    requiredParams: mappedTool.parameters.required,
    taskId: task.id,
    status: 'OK',
  }
}

testAddCelestialNodeMcpTool.description =
  'Import a CelestialNode-style MCP tool definition and convert it into a Taskyon tooldefinition task.'

