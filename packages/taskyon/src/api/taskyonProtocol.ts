import { defineFrpProtocol } from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import { partialTaskDraft, TaskNode } from '../types/taskNode'
import { FunctionArguments, ToolBase } from '../types/tools'

export const REMOTE_FUNCTION_TIMEOUT_MS = 30_000
export const MAX_REMOTE_FUNCTION_TIMEOUT_MS = 10 * 60 * 1000

const baseMessage = z.object({
  origin: z.string().optional(),
  peerId: z.string().optional(),
})

const importTaskArchive = z.object({
  data: z.instanceof(Uint8Array<ArrayBuffer>) as z.ZodType<Uint8Array<ArrayBuffer>>,
  info: z.string(),
  ids: z.array(z.string()),
})

const requestTaskArchive = z.object({
  id: z.string(),
})

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

const tasks = z.object({
  execute: z.boolean().default(false),
  tasks: partialTaskDraft.array(),
  show: z.boolean().default(false).meta({
    description: 'select the last task in the GUI',
  }),
})

const functionDescription = ToolBase.extend({}).meta({
  description: 'Register a tool definition with this Taskyon peer.',
})

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

const file = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  store: z.enum(['memory', 'opfs']).optional(),
  file: browserFile, // only supported over MessageChannel for now
})

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

const functionCancel = remoteFunctionBase
  .extend({
    reason: z.string().optional().meta({
      description: 'Optional human-readable reason for the cancellation.',
    }),
  })
  .meta({
    description: 'Cancels a pending remote function call identified by requestId.',
  })

export const taskyonProtocol = defineFrpProtocol({
  id: 'taskyon.core',
  version: '1',
  envelope: baseMessage,
  commands: {
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
    getTask: {
      request: z
        .object({
          id: z.string().describe('Task id to fetch from the local Taskyon task store.'),
        })
        .describe('Request a task by id from the local Taskyon task store.'),
      response: TaskNode.nullable().describe('The matching task, or null when it is unavailable.'),
      defaultTimeoutMs: 30_000,
    },
    createTask: {
      request: task,
    },
    createTaskChain: {
      request: tasks,
    },
    addFile: {
      request: file,
    },
    registerTool: {
      request: functionDescription,
    },
    requestTaskArchive: {
      request: requestTaskArchive,
    },
    importTaskArchive: {
      request: importTaskArchive,
    },
  },
  streams: {
    taskUpdates: {
      taskCreated,
    },
    peerLifecycle: {
      taskyonReady,
      status,
    },
    toolExecution: {
      functionCall,
      functionResponse,
      functionCancel,
    },
  },
})
