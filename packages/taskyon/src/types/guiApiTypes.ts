import type { PartialDeep } from 'type-fest'
import { z } from 'zod'
import { BaseMessage, TaskyonMessage } from './apiTypes'

export type partialTyConfiguration = PartialDeep<{
  llmSettings: Record<string, unknown>
  appConfiguration: Record<string, unknown>
  toolchainConfig: Record<string, Record<string, unknown>>
  signatureOrKey: unknown
}>

const pastedFilePayload = z.object({
  name: z.string(),
  type: z.string(),
  data: z.string().meta({
    description: 'Base64-encoded file payload bridged from the host app.',
  }),
})

const tyConfigurationMessage = z.object({
  type: z.literal('configurationMessage').meta({
    description: 'Field to indicate that this is a configuration message.',
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
  conf: z.record(z.string(), z.unknown()),
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
  ...TaskyonMessage.options,
  z.object({ ...BaseMessage.shape, ...tyConfigurationMessage.shape }),
  z.object({ ...BaseMessage.shape, ...tyPasteMessage.shape }),
])

export type TaskyonGuiMessage = z.infer<typeof TaskyonGuiMessage>
export type guiMessageTypes = TaskyonGuiMessage['type']
