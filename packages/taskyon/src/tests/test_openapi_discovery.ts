import {
  createProtocolPort,
  createPortClient,
  createPortServer,
} from '@taskyon/common/modules/frpBus'
import { taskyonProtocol } from '../api/taskyonProtocol'
import { createTaskyonApiDescription } from '../api/taskyonOpenApi'
import type { ToolBase } from '../types/tools'
import { z } from 'zod'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const exampleTool: ToolBase = {
  name: 'exampleTool',
  description: 'Returns an example value.',
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
    additionalProperties: false,
  },
}

export const testTaskyonOpenApiIncludesRuntimeTools = () => {
  const description = createTaskyonApiDescription(taskyonProtocol, {
    exampleTool,
  })
  const tool = description.document['x-taskyon-tools']?.exampleTool

  assert(tool !== undefined, 'Expected the runtime tool in the OpenAPI document.')
  const parameters = z
    .object({
      properties: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(tool?.parameters)
  assert(
    parameters.properties?.value !== undefined,
    'Expected the tool parameter schema from ToolBase.',
  )
  assert(tool?.result !== undefined, 'Expected the unconstrained v1 result schema.')

  const changed = createTaskyonApiDescription(taskyonProtocol, {})
  assert(
    description.revision !== changed.revision,
    'Expected runtime tool changes to update the document revision.',
  )

  return { success: true, revision: description.revision }
}

export const testTaskyonOpenApiDescribesCoreMutationOperations = () => {
  const document = createTaskyonApiDescription(taskyonProtocol, {}).document
  const undocumented = Object.values(document.paths)
    .map((path) => path.post)
    .filter((operation) => !operation.summary)
    .map((operation) => operation.operationId)
  assert(
    undocumented.length === 0,
    `Expected every operation to have a protocol-owned summary; missing: ${undocumented.join(', ')}.`,
  )
  return { success: true }
}

export const testTaskyonOpenApiDescribesTaskFields = () => {
  const document = createTaskyonApiDescription(taskyonProtocol, {}).document
  const request = document.components.schemas.TaskCreateRequest
  if (!request) throw new Error('Expected task.create request schema.')
  const task = request.properties?.task
  if (!task || typeof task === 'boolean') throw new Error('Expected task.create task schema.')
  const properties = task.properties ?? {}
  const undocumented = Object.entries(properties)
    .filter(([, schema]) => typeof schema !== 'boolean' && !schema.description?.trim())
    .map(([name]) => name)

  assert(
    undocumented.length === 0,
    `Expected descriptions for public task fields; missing: ${undocumented.join(', ')}.`,
  )

  const content = properties.content
  if (!content || typeof content === 'boolean') throw new Error('Expected task content schema.')
  const undocumentedContent = (content.anyOf ?? []).flatMap((branch, index) => {
    if (typeof branch === 'boolean') return []
    return Object.entries(branch.properties ?? {})
      .filter(([, schema]) => typeof schema !== 'boolean' && !schema.description?.trim())
      .map(([name]) => `content[${index}].${name}`)
  })
  assert(
    undocumentedContent.length === 0,
    `Expected descriptions for task content fields; missing: ${undocumentedContent.join(', ')}.`,
  )
  return { success: true }
}

export const testTaskyonDiscoveryDescribeUsesFrpCommand = async () => {
  const { x: clientPort, y: serverPort } = createProtocolPort(taskyonProtocol)
  const stop = createPortServer(serverPort, taskyonProtocol, {
    discovery: {
      describe: () =>
        createTaskyonApiDescription(taskyonProtocol, {
          exampleTool,
        }),
    },
  })

  try {
    const result = await createPortClient(clientPort, taskyonProtocol).discovery.describe({})
    assert(result.document.openapi === '3.1.0', 'Expected OpenAPI through the FRP command.')
    assert(
      result.document['x-taskyon-tools']?.exampleTool !== undefined,
      'Expected current tools through discovery.',
    )
    return { success: true }
  } finally {
    stop()
  }
}

testTaskyonOpenApiIncludesRuntimeTools.description =
  'Adds current Taskyon tool definitions to OpenAPI and revisions.'
testTaskyonOpenApiDescribesCoreMutationOperations.description =
  'Publishes protocol-owned summaries for every advertised operation.'
testTaskyonOpenApiDescribesTaskFields.description =
  'Publishes descriptions for every top-level task field exposed by the peer API.'
testTaskyonDiscoveryDescribeUsesFrpCommand.description =
  'Publishes the generated OpenAPI document through discovery.describe.'
