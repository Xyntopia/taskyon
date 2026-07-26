import { defineFrpServiceProtocol } from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import { TaskNode } from '../types/taskNode.ts'
import { taskResult } from '../types/toolApi.ts'

export const toolContextProtocol = defineFrpServiceProtocol({
  service: 'toolContext',
  version: '1',
  commands: {
    getSecret: {
      request: z.object({
        name: z.string(),
        askNew: z.union([z.boolean(), z.string()]),
        saveNew: z.boolean().optional(),
      }),
      response: z.string().nullable(),
    },
    setSecret: {
      request: z.object({ name: z.string(), value: z.string() }),
    },
    getExecutionTaskChain: {
      request: z.object({}),
      response: TaskNode.array(),
    },
    createSubtasksResult: {
      request: z.object({ tasks: z.unknown() }),
      response: taskResult,
    },
    waitForInteraction: {
      request: z.object({
        tool: z.string().optional(),
        token: z.string().optional(),
      }),
      response: z.unknown(),
    },
  },
})
