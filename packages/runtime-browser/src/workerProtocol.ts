import type { FunctionArguments, llmSettings, partialTaskDraft } from '@taskyon/taskyon'
import type { TaskyonCoreRuntimeStage } from './core'

export type TaskyonBrowserWorkerInitMessage = {
  type: 'init'
  corePort: MessagePort
  hostPort: MessagePort
  storagePort: MessagePort
  llmSettings: llmSettings
  entryNode?: partialTaskDraft
  toolchainConfig?: Record<string, FunctionArguments>
  storageNamespacePrefix: string
  storageSessionId?: string
  persistCryptoSession?: boolean
  cryptoNamespace?: string
}

export type TaskyonBrowserWorkerMessage =
  | {
      type: 'runtimeStage'
      stage: TaskyonCoreRuntimeStage
    }
  | {
      type: 'runtimeError'
      message: string
      stack?: string
    }
