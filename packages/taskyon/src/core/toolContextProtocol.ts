import { defineFrpServiceProtocol } from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import { TaskNode } from '../types/taskNode.ts'
import { taskResult } from '../types/toolApi.ts'
import { ContentHash, ToolInvocationRevisions } from '../types/tools.ts'

export const toolContextProtocol = defineFrpServiceProtocol({
  service: 'toolContext',
  version: '2',
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
    resolveInvocation: {
      request: z.object({
        name: z.string(),
        toolRevision: ContentHash.optional(),
        settingsRevision: ContentHash.optional(),
      }),
      response: ToolInvocationRevisions.nullable(),
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
        protocolVersion: z.literal(2),
        input: z.string(),
        preferProxy: z.boolean().optional(),
        init: z
          .object({
            method: z.string().optional(),
            headers: z.array(z.tuple([z.string(), z.string()])).optional(),
            body: z.string().optional(),
            cache: z
              .enum(['default', 'no-store', 'reload', 'no-cache', 'force-cache', 'only-if-cached'])
              .optional(),
          })
          .optional(),
      }),
      response: z.object({
        status: z.number(),
        statusText: z.string(),
        headers: z.array(z.tuple([z.string(), z.string()])),
        protocolVersion: z.literal(2),
        bodyId: z.string().optional(),
      }),
    },
  },
  streams: {
    fetchBody: {
      fetchBodyReadRequest: z.object({ requestId: z.string(), bodyId: z.string() }),
      fetchBodyReadResponse: z.object({
        requestId: z.string(),
        result: z
          .object({
            done: z.boolean(),
            data: z.array(z.number().int().min(0).max(255)).max(65536).optional(),
          })
          .optional(),
        error: z.object({ name: z.string(), message: z.string() }).optional(),
      }),
      fetchBodyCancelRequest: z.object({ requestId: z.string(), bodyId: z.string() }),
      fetchBodyCancelResponse: z.object({ requestId: z.string() }),
    },
  },
})
