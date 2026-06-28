import { z } from 'zod'
import { sha256UrlSafeHashFromFile } from '../utils/encoding'
import type { ByType } from '../utils/tsHelpers'
import { RemoteFunctionCall, RemoteFunctionCancel, RemoteFunctionResponse } from './messages'
import { partialTaskDraft, TaskNode } from './taskNode'
import { ToolBase } from './tools'

// TODO: most of the messages here should have an equivalent encrypted version!

// TODO: merge this with "taskCreated" message!
export const EncryptedTasks = z.object({
  type: z.literal('addTasks'),
  data: z.instanceof(Uint8Array<ArrayBuffer>) as z.ZodType<Uint8Array<ArrayBuffer>>,
  info: z.string(),
  ids: z.array(z.string()),
})

export const RequestTask = z.object({
  type: z.literal('requestTask'),
  id: z.string(),
})

export const TaskCreated = z.object({
  type: z.literal('taskCreated'),
  task: TaskNode.optional(),
  // TODO: add optional encrypted task!
  ids: z.array(z.string()).optional(),
  info: z.string().optional(),
})

const TaskMessage = z
  .object({
    type: z.literal('task').meta({
      description: 'Field to indicate what kind of a message we have here.',
    }),
    task: partialTaskDraft,
    // TODO: we don't need this anymore..   any functioncall task is one that should be "executed"
    execute: z.boolean().default(false).meta({
      description: 'should the task be queued for execution?',
    }),
    /* TODO: this needs to be captured in the frontend somehow!
    // but we first add it to the tasks and get back a content ID in the backend.
    // so not sure yet how to do this...The backend soehow would have to communicate this to the frontend..
    // maybe we could do this through teh "back-channel?"*/
    show: z.boolean().default(false).meta({
      description: 'select the task in the GUI',
    }),
  })
  .meta({
    description:
      'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  })

// merge this with "TaskMessage"
const TaskChainMessage = z.object({
  type: z.literal('tasks').meta({
    description: 'Field to indicate what kind of a message we have here.',
  }),
  execute: z.boolean().default(false),
  tasks: partialTaskDraft.array(),
  show: z.boolean().default(false).meta({
    description: 'select the last task in the GUI',
  }),
})

const FunctionDescriptionMessage = ToolBase.extend({
  type: z.literal('functionDescription').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
})

const TyReadyMessage = z.object({ type: z.literal('taskyonReady') }).meta({
  description: 'simple message which signals, that our API is ready!',
})

const ToolDefinitionsRequestMessage = z.object({
  type: z.literal('toolDefinitionsRequest'),
  requestId: z.string(),
  includeHidden: z.boolean().optional(),
})

const ToolDefinitionsResponseMessage = z.object({
  type: z.literal('toolDefinitionsResponse'),
  requestId: z.string(),
  tools: z.record(z.string(), ToolBase),
})

export const BaseMessage = z.object({
  origin: z.string().optional(),
  peerId: z.string().optional(),
})

const TyStatusMessage = z
  .object({
    type: z.literal('status'),
    data: z.object({
      type: z.literal('newtool'),
      id: z.string().meta({ description: 'id of new tool' }),
    }),
  })
  .meta({ description: 'A list of status message for taskyon' })

export const TaskWorkerMessage = z.discriminatedUnion('type', [
  z.object({ ...BaseMessage.shape, ...RemoteFunctionCall.shape }),
  z.object({ ...BaseMessage.shape, ...RemoteFunctionResponse.shape }),
  z.object({ ...BaseMessage.shape, ...RemoteFunctionCancel.shape }),
])
export type TaskWorkerMessage = z.infer<typeof TaskWorkerMessage>

// File message
export const FileMessage = z.object({
  type: z.literal('file'),
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  store: z.enum(['memory', 'opfs']).optional(),
  file: z.file(), // only supported over MessageChannel for now
})
export type FileMessage = z.infer<typeof FileMessage>

export const TyP2P = z.discriminatedUnion('type', [EncryptedTasks, RequestTask, TaskCreated])
export type TyP2P = z.infer<typeof TyP2P>

export const TyBusMessage = z.discriminatedUnion('type', [
  ...TyP2P.options,
  z.object({ ...BaseMessage.shape, ...TyStatusMessage.shape }),
  ...TaskWorkerMessage.options,
])

export const TaskyonMessage = z.discriminatedUnion('type', [
  // TODO: can we unify the task message with the SyncApi?
  ...TyBusMessage.options,
  z.object({ ...BaseMessage.shape, ...TaskMessage.shape }),
  z.object({ ...BaseMessage.shape, ...TaskChainMessage.shape }),
  z.object({ ...BaseMessage.shape, ...FunctionDescriptionMessage.shape }),
  z.object({ ...BaseMessage.shape, ...TyReadyMessage.shape }),
  z.object({ ...BaseMessage.shape, ...ToolDefinitionsRequestMessage.shape }),
  z.object({ ...BaseMessage.shape, ...ToolDefinitionsResponseMessage.shape }),
  z.object({ ...BaseMessage.shape, ...FileMessage.shape }),
])

// If you want to map them to { label, value } for q-select:
/*export const messageTypes = TaskyonMessage.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})*/

export type TaskyonMessage = z.infer<typeof TaskyonMessage>
export type messageTypes = TaskyonMessage['type']

export const sendFile =
  (send: (msg: ByType<'file', TaskyonMessage>) => void) => async (file: File) => {
    const id = await sha256UrlSafeHashFromFile(file)
    send({
      type: 'file',
      id,
      name: file.name,
      mime: file.type,
      size: file.size,
      file,
    })
    return id
  }
