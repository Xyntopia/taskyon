import type { DeepPartial } from 'quasar'
import type { storedSettings } from './types'
import { FunctionArguments, ToolBase, partialTaskDraft } from './types'
import { z } from 'zod'

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
}).meta({
  description:
    'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
})
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>

//export type partialTyConfiguration = PartialDeep<storedSettings>
export type partialTyConfiguration = DeepPartial<storedSettings>
//export type partialTyConfiguration = PartialDeep<storedSettings>

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
    duplicateTaskName: z
      .boolean()
      .default(true)
      .describe(
        `Only add the task if a task with this name doesn't exist. We do this, because otherwise tasks get
            added on every page-load if we configure our app through an iframe parent.`,
      ),
  })
  .meta({
    description:
      'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  })

const FunctionDescriptionMessage = ToolBase.extend({
  type: z.literal('functionDescription').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
  id: z.string()
    .describe(`A unique id for the function definition task. Tasks with the same id "overwrite" each other. The last one
    is the relevant one. Functions will get saved as a task object with the id as their name.

    this is important!, Taskyon can be configured to prevent tasks from getting created if they already exist with the same name!
    this helps in making sure, that tasks & tools which we upload to taskyon on pageload don't get duplicated
    on every pageload.
    If that option is turned on, we can use this as a version string for our tasks... And every time we want
    to update our webpage with a new AI tool, we simply change the version string...
    `),
  duplicateTaskName: z.boolean().meta({
    description:
      'we use this here in order to prevent duplicate creation of our function declaration task',
  }),
})

const tyConfigurationMessage = z.object({
  type: z.literal('configurationMessage').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
  conf: z.record(z.string(), z.unknown()),
})

const TyReadyMessage = z.object({ type: z.literal('taskyonReady') }).meta({
  description: 'simple message which signals, that our API is ready!',
})

export const TaskyonMessage = z.discriminatedUnion('type', [
  RemoteFunctionCall,
  RemoteFunctionResponse,
  TaskMessage,
  FunctionDescriptionMessage,
  TyReadyMessage,
  tyConfigurationMessage,
])
export type TaskyonMessage = z.infer<typeof TaskyonMessage>
