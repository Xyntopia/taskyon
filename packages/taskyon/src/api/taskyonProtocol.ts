import { defineFrpProtocol } from '@taskyon/shared/modules/frpBus'
import { ToolBase } from '../types/tools'
import { z } from 'zod'

export const taskyonProtocol = defineFrpProtocol({
  id: 'taskyon.core',
  version: '1',
  rpc: {
    listTools: {
      request: z
        .object({
          includeHidden: z
            .boolean()
            .optional()
            .describe('Include internal and hidden tools in the returned tool definition map.'),
        })
        .describe('Request the currently registered Taskyon tool definitions.'),
      response: z
        .record(z.string(), ToolBase)
        .describe('The currently registered Taskyon tool definitions keyed by tool name.'),
      defaultTimeoutMs: 30_000,
    },
  },
})
