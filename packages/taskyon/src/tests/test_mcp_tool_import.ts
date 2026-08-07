import { createToolManager, type ToolStorageRecord } from '../core/toolManager'
import { ToolBase } from '../types/tools'
import { createMapCrudWrapper } from '../utils/crudWrapper'
import type { JSONSchema7 } from '../utils/jsonSchema'

type CelestialMcpTool = {
  name: string
  description: string
  inputSchema: Readonly<JSONSchema7>
}

const celestialNodeExample: CelestialMcpTool = {
  name: 'search_asteroids',
  description: 'Search near-earth objects by date range and optional diameter filters.',
  inputSchema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      min_diameter_km: { type: 'number' },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
  },
}

export const testAddCelestialNodeMcpTool = async () => {
  const mappedTool = ToolBase.strict().parse({
    name: celestialNodeExample.name,
    description: celestialNodeExample.description,
    longDescription:
      'Imported from an MCP-style tool definition (CelestialNode-like space data endpoint).',
    parameters: celestialNodeExample.inputSchema,
  })
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const ref = await toolManager.installManifest({
    publisherId: 'celestial-node',
    name: mappedTool.name,
    description: mappedTool.description,
    ...(mappedTool.longDescription ? { longDescription: mappedTool.longDescription } : {}),
    parameters: mappedTool.parameters,
    execution: {
      kind: 'external-service',
      serviceId: 'celestial-node',
      implementationRevision: 'sha256:publisher-attested-example',
    },
  })

  if ((await toolManager.resolveActiveRevision(mappedTool.name)) !== ref.revision) {
    throw new Error('Imported MCP tool was not activated by ToolManager')
  }
  return { toolName: mappedTool.name, revision: ref.revision, status: 'OK' }
}

testAddCelestialNodeMcpTool.description =
  'Import a CelestialNode-style MCP definition into Taskyon ToolManager.'
