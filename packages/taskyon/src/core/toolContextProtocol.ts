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
    fetch: {
      request: z.object({
        input: z.string(),
        init: z
          .object({
            method: z.string().optional(),
            headers: z.array(z.tuple([z.string(), z.string()])).optional(),
            body: z.string().optional(),
          })
          .optional(),
      }),
      response: z.object({
        status: z.number(),
        statusText: z.string(),
        headers: z.array(z.tuple([z.string(), z.string()])),
        body: z.string().optional(),
        bodyBase64: z.string().optional(),
      }),
    },
  },
})
