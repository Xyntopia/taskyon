import {
  defineFrpProtocol,
  mergeFrpProtocols,
  type ProtocolMessage,
} from '@taskyon/shared/modules/frpBus'
import type { PartialDeep } from 'type-fest'
import { z } from 'zod'
import { taskyonProtocol } from '../api/taskyonProtocol'
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

const configureTaskyon = z.object({
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

const pasteClipboard = z.object({
  text: z.string().optional(),
  html: z.string().optional(),
  files: z.array(pastedFilePayload).optional(),
})

const taskyonGuiCommandsProtocol = defineFrpProtocol({
  id: 'taskyon.gui',
  version: '1',
  envelope: BaseMessage,
  commands: {
    configureTaskyon: {
      request: configureTaskyon,
    },
    pasteClipboard: {
      request: pasteClipboard,
    },
  },
})

export const taskyonGuiProtocol = mergeFrpProtocols({
  id: 'taskyon.gui',
  version: '1',
  base: taskyonProtocol,
  extension: taskyonGuiCommandsProtocol,
})

export const TaskyonGuiMessage = z.discriminatedUnion('type', [
  ...TaskyonMessage.options,
  z.object({ ...BaseMessage.shape, ...taskyonGuiProtocol.commands.configureTaskyon.request.shape }),
  z.object({
    ...BaseMessage.shape,
    ...taskyonGuiProtocol.commands.configureTaskyon.response.shape,
  }),
  z.object({ ...BaseMessage.shape, ...taskyonGuiProtocol.commands.pasteClipboard.request.shape }),
  z.object({ ...BaseMessage.shape, ...taskyonGuiProtocol.commands.pasteClipboard.response.shape }),
])

export type TaskyonGuiMessage = ProtocolMessage<typeof taskyonGuiProtocol>
export type guiMessageTypes = TaskyonGuiMessage['type']
