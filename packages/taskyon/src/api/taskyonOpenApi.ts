import { canonicalHash, type Sha256Hash } from '@taskyon/common/modules/canonicalHash'
import {
  createProtocolOpenApiDocument,
  type TaskyonOpenApiDocument,
} from '@taskyon/common/modules/openApi'
import type { FrpProtocolDefinition } from '@taskyon/common/modules/frpBus'
import type { ToolBase } from '../types/tools'
import type { z } from 'zod'

type RuntimeProtocol = FrpProtocolDefinition<
  Record<
    string,
    {
      request: z.ZodType
      response: z.ZodType
    }
  >,
  Record<string, Record<string, z.ZodType>>,
  z.ZodType | undefined
>

export type TaskyonApiDescription = {
  document: TaskyonOpenApiDocument
  revision: Sha256Hash
}

export const createTaskyonApiDescription = (
  protocol: RuntimeProtocol,
  tools: Record<string, ToolBase>,
): TaskyonApiDescription => {
  const baseDocument = createProtocolOpenApiDocument(protocol, {
    title: 'Taskyon Peer API',
    description:
      'Runtime description of the FRP services, streams, and tools advertised by this Taskyon peer.',
  })
  const toolEntries = Object.entries(tools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, tool]) => [
      name,
      {
        description: tool.description,
        ...(tool.longDescription ? { longDescription: tool.longDescription } : {}),
        parameters: tool.parameters,
        result: {},
      },
    ])
  const document: TaskyonOpenApiDocument = {
    ...baseDocument,
    'x-taskyon-tools': Object.fromEntries(toolEntries),
  }

  return {
    document,
    revision: canonicalHash(document),
  }
}
