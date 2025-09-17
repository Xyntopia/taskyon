import type { PartialDeep } from 'type-fest'
import { TyProfile } from './types'
import { z } from 'zod'
import { FunctionArguments, ToolBase } from '@taskyon/taskyon'
import { partialTaskDraft } from '@taskyon/taskyon'

export const EncryptedTasks = z.object({
  type: z.literal('addTasks'),
  data: z.instanceof(Uint8Array<ArrayBuffer>) as z.ZodType<Uint8Array<ArrayBuffer>>,
  info: z.string(),
  ids: z.array(z.string()),
})
//type TaskMessage = z.infer<typeof EncryptedTasks>

const RemoteFunctionBase = z.object({
  functionName: z.string().meta({
    description: 'the name of the function',
  }),
})

export const RemoteFunctionCall = RemoteFunctionBase.extend({
  type: z.literal('functionCall').meta({
    description: 'Field to indicate what kind of a message we have here.',
  }),
  arguments: FunctionArguments.optional().meta({
    description: 'the arguments for the function as a json object',
  }),
}).meta({
  description:
    'This type is used for sending messages with function calls between windows. E.g. from iframe to parent',
})
export type RemoteFunctionCall = z.infer<typeof RemoteFunctionCall>

export const RemoteFunctionResponse = RemoteFunctionBase.extend({
  type: z.literal('functionResponse').meta({
    description: 'Field to indicate what kind of a message we have here.',
  }),
  response: z.unknown().optional().meta({
    description: 'response of a FunctionCall, e.g. through postMessage with iframes.',
  }),
  error: z
    .unknown()
    .optional()
    .meta({ description: 'if an error occurs in the remote function, we can use this property' }),
}).meta({
  description:
    'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
})
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>

//export type partialTyConfiguration = PartialDeep<storedSettings>
export type partialTyConfiguration = PartialDeep<TyProfile>
//export type partialTyConfiguration = PartialDeep<storedSettings>

export const RequestTask = z.object({
  type: z.literal('requestTask'),
  id: z.string(),
})
//type RequestTask = z.infer<typeof RequestTask>

export const TaskCreated = z.object({
  type: z.literal('taskCreated'),
  ids: z.array(z.string()),
  info: z.string(),
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

const FunctionDescriptionMessage = ToolBase.extend({
  type: z.literal('functionDescription').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
})

const tyConfigurationMessage = z.object({
  type: z.literal('configurationMessage').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
  persist: z.boolean().optional().meta({
    description:
      'persist the configuration on the disk, so that it is loaded faster on subsequent sessions.',
  }),
  conf: z.union([z.record(z.string(), z.unknown()), TyProfile]),
})

const TyReadyMessage = z.object({ type: z.literal('taskyonReady') }).meta({
  description: 'simple message which signals, that our API is ready!',
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
])
export type TaskWorkerMessage = z.infer<typeof TaskWorkerMessage>

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
  z.object({ ...BaseMessage.shape, ...FunctionDescriptionMessage.shape }),
  z.object({ ...BaseMessage.shape, ...TyReadyMessage.shape }),
  z.object({ ...BaseMessage.shape, ...tyConfigurationMessage.shape }),
])

// If you want to map them to { label, value } for q-select:
/*export const messageTypes = TaskyonMessage.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})*/

export type TaskyonMessage = z.infer<typeof TaskyonMessage>
export type messageTypes = TaskyonMessage['type']
