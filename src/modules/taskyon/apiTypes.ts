import type { PartialDeep } from 'type-fest'
import { z } from 'zod'
import { TyProfile } from './types'
import { TaskyonMessage, BaseMessage } from '@taskyon/taskyon'

export type partialTyConfiguration = PartialDeep<TyProfile>

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

export const TaskyonGuiMessage = z.discriminatedUnion('type', [
  // TODO: can we unify the task message with the SyncApi?
  ...TaskyonMessage.options,
  z.object({ ...BaseMessage.shape, ...tyConfigurationMessage.shape }),
])

// If you want to map them to { label, value } for q-select:
/*export const messageTypes = TaskyonMessage.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})*/

export type TaskyonGuiMessage = z.infer<typeof TaskyonGuiMessage>
export type messageTypes = TaskyonGuiMessage['type']
