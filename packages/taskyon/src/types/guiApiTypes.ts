import {
  defineFrpProtocol,
  mergeFrpProtocols,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import type { PartialDeep } from 'type-fest'
import { z } from 'zod'
import { taskyonProtocol } from '../api/taskyonProtocol'

export type partialTyConfiguration = PartialDeep<{
  llmSettings: Record<string, unknown>
  appConfiguration: Record<string, unknown>
  toolchainProfiles: {
    base: Record<string, Record<string, unknown>>
    profiles: Record<string, Record<string, Record<string, unknown>>>
  }
  selectedToolchainProfile: string
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
  origin: z.string().optional().meta({
    description: 'Origin of the iframe host application.',
  }),
  peerId: z.string().optional().meta({
    description: 'Logical identifier of the iframe host application.',
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
  envelope: taskyonProtocol.envelope,
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

export const TaskyonGuiMessage = taskyonGuiProtocol.message
export type TaskyonGuiMessage = ProtocolMessage<typeof taskyonGuiProtocol>
export type guiMessageTypes = TaskyonGuiMessage['type']
