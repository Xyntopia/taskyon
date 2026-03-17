import { BaseMessage, TaskyonMessage } from '@taskyon/taskyon/api'
import type { PartialDeep } from 'type-fest'
import { z } from 'zod'
import { TyProfile } from './types'

export type partialTyConfiguration = PartialDeep<TyProfile>

const pastedFilePayload = z.object({
  name: z.string(),
  type: z.string(),
  data: z.string().meta({
    description: 'Base64-encoded file payload bridged from the VS Code host webview.',
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
  profileName: z.string().optional().meta({
    description: 'Optional profile name provided by iframe host app.',
  }),
  bindingKey: z.any().optional().meta({
    description:
      'Optional binding key from iframe host app. Can be a base64 public key string or CryptoKey.',
  }),
  missingBindingKeyPolicy: z.enum(['deriveFromProfile', 'noBindingKey']).optional().meta({
    description: 'How to handle undefined binding key in iframe mode.',
  }),
  conf: z.union([z.record(z.string(), z.unknown()), TyProfile]),
})

const tyPasteMessage = z.object({
  type: z.literal('pasteMessage').meta({
    description: 'Clipboard paste payload forwarded by the host iframe client.',
  }),
  text: z.string().optional(),
  html: z.string().optional(),
  files: z.array(pastedFilePayload).optional(),
})

export const TaskyonGuiMessage = z.discriminatedUnion('type', [
  // TODO: can we unify the task message with the SyncApi?
  ...TaskyonMessage.options,
  z.object({ ...BaseMessage.shape, ...tyConfigurationMessage.shape }),
  z.object({ ...BaseMessage.shape, ...tyPasteMessage.shape }),
])

// If you want to map them to { label, value } for q-select:
/*export const messageTypes = TaskyonMessage.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})*/

export type TaskyonGuiMessage = z.infer<typeof TaskyonGuiMessage>
export type messageTypes = TaskyonGuiMessage['type']
