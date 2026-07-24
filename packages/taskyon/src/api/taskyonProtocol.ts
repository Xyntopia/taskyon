import {
  defineFrpServiceProtocol,
  mergeFrpProtocols,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { TaskyonOpenApiDocumentSchema } from '@taskyon/common/modules/openApi'
import type { Sha256Hash } from '@taskyon/common/modules/canonicalHash'
import { z } from 'zod'
import { partialTaskDraft, TaskNode } from '../types/taskNode'
import { ToolProgress } from '../types/toolApi'
import { FunctionArguments, ToolBase } from '../types/tools'
import { TyToolchainConfig } from '../types/profiles'

export const REMOTE_FUNCTION_TIMEOUT_MS = 30_000
export const MAX_REMOTE_FUNCTION_TIMEOUT_MS = 10 * 60 * 1000

const baseMessage = z.object({
  origin: z.string().optional(),
  peerId: z.string().optional(),
})

const importTaskArchive = z
  .object({
    data: (z.instanceof(Uint8Array<ArrayBuffer>) as z.ZodType<Uint8Array<ArrayBuffer>>).describe(
      'Binary task archive data.',
    ),
    info: z.string().describe('Human-readable archive information.'),
    ids: z.array(z.string()).describe('Task ids contained in the archive.'),
  })
  .describe('Import a Taskyon task archive into the local task store.')

const requestTaskArchive = z
  .object({
    id: z.string().describe('Task id whose archive should be requested.'),
  })
  .describe('Request an exportable archive for a task and its related data.')

const taskCreated = z.object({
  type: z.literal('taskCreated'),
  task: TaskNode.optional(),
  // TODO: add optional encrypted task.
  ids: z.array(z.string()).optional(),
  info: z.string().optional(),
})

const task = z
  .object({
    task: partialTaskDraft,
    // TODO: any function-call task should eventually imply execution without this flag.
    execute: z.boolean().default(false).meta({
      description: 'should the task be queued for execution?',
    }),
    show: z.boolean().default(false).meta({
      description: 'select the task in the GUI',
    }),
  })
  .meta({
    description:
      'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  })

const tasks = z
  .object({
    execute: z.boolean().default(false).describe('Queue the created task chain for execution.'),
    tasks: partialTaskDraft.array().describe('Ordered task drafts to create as one chain.'),
    show: z.boolean().default(false).meta({
      description: 'select the last task in the GUI',
    }),
  })
  .describe('Create an ordered Taskyon task chain.')

const functionDescription = ToolBase.extend({}).meta({
  description: 'Register a tool definition with this Taskyon peer.',
})

const ping = z
  .object({
    nonce: z.string().optional(),
  })
  .describe('Check whether this Taskyon peer is ready to handle core protocol requests.')

const pingResult = z
  .object({
    ok: z.literal(true),
    protocol: z.literal('taskyon.core'),
    version: z.literal('1'),
    status: z.literal('ready'),
    nonce: z.string().optional(),
  })
  .describe('Taskyon core protocol readiness response.')

const taskChainSelection = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('flattened'),
    untilTaskID: z.string().optional(),
    onlyFirstChild: z.boolean().optional(),
  }),
  z.object({
    method: z.literal('lineage'),
    includeSubtaskResults: z.enum(['terminal-visible', 'none']).optional(),
  }),
])

const taskyonReady = z.object({}).meta({
  description: 'simple message which signals, that our API is ready!',
})

const status = z
  .object({
    data: z.object({
      type: z.literal('newtool'),
      id: z.string().meta({ description: 'id of new tool' }),
    }),
  })
  .meta({ description: 'A list of status message for taskyon' })

const browserFile = z.custom<File>(
  (value) => typeof globalThis.File !== 'undefined' && value instanceof globalThis.File,
)

const file = z
  .object({
    id: z.string().describe('Content-derived file id.'),
    name: z.string().describe('Original file name.'),
    mime: z.string().describe('File media type.'),
    size: z.number().describe('File size in bytes.'),
    store: z.enum(['memory', 'opfs']).optional().describe('Requested local file storage backend.'),
    file: browserFile.describe('Browser File payload transferred over MessageChannel.'),
  })
  .describe('Register a file with the local Taskyon peer.')

const remoteFunctionBase = z.object({
  functionName: z.string().meta({
    description: 'the name of the function',
  }),
  requestId: z.string().meta({
    description: 'unique request id used to correlate a remote function call with its response',
  }),
})

const functionCall = remoteFunctionBase
  .extend({
    taskId: z.string().optional().meta({
      description: 'Task id whose function call is being executed, when available.',
    }),
    arguments: FunctionArguments.optional().meta({
      description: 'the arguments for the function as a json object',
    }),
  })
  .meta({
    description:
      'This type is used for sending messages with function calls between windows. E.g. from iframe to parent',
  })

const functionResponse = remoteFunctionBase
  .extend({
    response: z.unknown().optional().meta({
      description: 'response of a FunctionCall, e.g. through postMessage with iframes.',
    }),
    error: z
      .unknown()
      .optional()
      .meta({ description: 'if an error occurs in the remote function, we can use this property' }),
  })
  .meta({
    description:
      'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
  })

const functionProgress = remoteFunctionBase
  .extend({
    taskId: z.string().optional(),
    progress: ToolProgress,
  })
  .meta({
    description: 'Reports non-terminal progress for a pending remote function call.',
  })

const functionCancel = remoteFunctionBase
  .extend({
    reason: z.string().optional().meta({
      description: 'Optional human-readable reason for the cancellation.',
    }),
  })
  .meta({
    description: 'Cancels a pending remote function call identified by requestId.',
  })

export const taskyonPeerProtocol = defineFrpServiceProtocol({
  service: 'peer',
  version: '1',
  envelope: baseMessage,
  commands: {
    ping: {
      request: ping,
      response: pingResult,
      defaultTimeoutMs: 5_000,
    },
  },
  streams: {
    lifecycle: {
      taskyonReady,
      status,
    },
  },
})

export const taskyonDiscoveryProtocol = defineFrpServiceProtocol({
  service: 'discovery',
  version: '1',
  envelope: baseMessage,
  commands: {
    describe: {
      request: z.object({}).describe('Request the current peer API and tool description.'),
      response: z
        .object({
          document: TaskyonOpenApiDocumentSchema,
          revision: z
            .custom<Sha256Hash>(
              (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value),
              'Invalid SHA-256 revision.',
            )
            .describe('Canonical SHA-256 revision of the OpenAPI document.'),
        })
        .describe('Current OpenAPI description advertised by this Taskyon peer.'),
      defaultTimeoutMs: 30_000,
    },
  },
})

export const taskyonRuntimeProtocol = defineFrpServiceProtocol({
  service: 'runtime',
  version: '1',
  envelope: baseMessage,
  commands: {
    configure: {
      request: z
        .object({
          toolchainConfig: TyToolchainConfig,
        })
        .describe('Apply one resolved flat toolchain configuration to this Taskyon runtime.'),
      response: z
        .discriminatedUnion('ok', [
          z.object({
            ok: z.literal(true),
          }),
          z.object({
            ok: z.literal(false),
            error: z.string(),
          }),
        ])
        .describe('Reports whether the runtime configuration and configured tools became active.'),
      defaultTimeoutMs: 30_000,
    },
  },
})

export const taskyonHostProtocol = taskyonRuntimeProtocol

export const taskyonToolsProtocol = defineFrpServiceProtocol({
  service: 'tools',
  version: '1',
  envelope: baseMessage,
  commands: {
    list: {
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
    register: {
      request: functionDescription,
    },
  },
  streams: {
    execution: {
      functionCall,
      functionProgress,
      functionResponse,
      functionCancel,
    },
  },
})

export const taskyonTaskProtocol = defineFrpServiceProtocol({
  service: 'task',
  version: '1',
  envelope: baseMessage,
  commands: {
    get: {
      request: z
        .object({
          id: z.string().describe('Task id to fetch from the local Taskyon task store.'),
        })
        .describe('Request a task by id from the local Taskyon task store.'),
      response: TaskNode.nullable().describe('The matching task, or null when it is unavailable.'),
      defaultTimeoutMs: 30_000,
    },
    getIdChain: {
      request: z
        .object({
          id: z.string().describe('Task id whose chain should be selected.'),
          maxFollow: z
            .number()
            .optional()
            .describe('Maximum number of task ids to include from the selected chain.'),
          selection: taskChainSelection
            .optional()
            .describe('Task-chain traversal strategy and options.'),
        })
        .describe('Request a selected task id chain from the local Taskyon task store.'),
      response: z.array(z.string()).describe('Selected task ids in chain order.'),
      defaultTimeoutMs: 30_000,
    },
    getChain: {
      request: z
        .object({
          id: z.string().describe('Task id whose chain should be loaded.'),
          maxFollow: z
            .number()
            .optional()
            .describe('Maximum number of tasks to include from the selected chain.'),
          selection: taskChainSelection
            .optional()
            .describe('Task-chain traversal strategy and options.'),
        })
        .describe('Request a selected task chain from the local Taskyon task store.'),
      response: z.array(TaskNode).describe('Selected tasks in chain order.'),
      defaultTimeoutMs: 30_000,
    },
    getChildChains: {
      request: z
        .object({
          id: z
            .string()
            .describe('Parent task id whose first-level child chains should be loaded.'),
        })
        .describe('Request every first-level child chain below one task.'),
      response: z
        .array(z.array(TaskNode))
        .describe('First-level child chains, with each sibling chain in execution order.'),
      defaultTimeoutMs: 30_000,
    },
    create: {
      request: task,
    },
    createChain: {
      request: tasks,
    },
  },
  streams: {
    updates: {
      taskCreated,
    },
  },
})

export const taskyonFilesProtocol = defineFrpServiceProtocol({
  service: 'files',
  version: '1',
  envelope: baseMessage,
  commands: {
    add: {
      request: file,
    },
  },
})

export const taskyonArchiveProtocol = defineFrpServiceProtocol({
  service: 'archive',
  version: '1',
  envelope: baseMessage,
  commands: {
    requestTask: {
      request: requestTaskArchive,
    },
    importTask: {
      request: importTaskArchive,
    },
  },
})

const taskyonDiscoveryPeerProtocol = mergeFrpProtocols({
  id: 'taskyon.peer',
  version: '1',
  base: taskyonDiscoveryProtocol,
  extension: taskyonPeerProtocol,
})

const taskyonPeerTaskProtocol = mergeFrpProtocols({
  id: 'taskyon.peer',
  version: '1',
  base: taskyonDiscoveryPeerProtocol,
  extension: taskyonTaskProtocol,
})

const taskyonPeerTaskToolsProtocol = mergeFrpProtocols({
  id: 'taskyon.peer',
  version: '1',
  base: taskyonPeerTaskProtocol,
  extension: taskyonToolsProtocol,
})

const taskyonPeerTaskToolsFilesProtocol = mergeFrpProtocols({
  id: 'taskyon.peer',
  version: '1',
  base: taskyonPeerTaskToolsProtocol,
  extension: taskyonFilesProtocol,
})

export const taskyonProtocol = mergeFrpProtocols({
  id: 'taskyon.peer',
  version: '1',
  base: taskyonPeerTaskToolsFilesProtocol,
  extension: taskyonArchiveProtocol,
})

export const TaskyonMessage = taskyonProtocol.message
export type TaskyonMessage = ProtocolMessage<typeof taskyonProtocol>
export type TaskyonMessageType = TaskyonMessage
export type TaskyonHostMessage = ProtocolMessage<typeof taskyonHostProtocol>
export type messageTypes = TaskyonMessage['type']
export type TyP2P = Extract<
  TaskyonMessage,
  | { type: 'archive.importTaskRequest' }
  | { type: 'archive.importTaskResponse' }
  | { type: 'archive.requestTaskRequest' }
  | { type: 'archive.requestTaskResponse' }
  | { type: 'taskCreated' }
>
