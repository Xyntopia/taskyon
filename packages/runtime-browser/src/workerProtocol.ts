import type { FunctionArguments, llmSettings, partialTaskDraft } from '@taskyon/taskyon'
import type { TaskyonCoreRuntimeStage } from './core'

export type TaskyonBrowserWorkerInitMessage = {
  type: 'init'
  corePort: MessagePort
  storagePort: MessagePort
  llmSettings: llmSettings
  entryNode?: partialTaskDraft
  toolchainConfig?: Record<string, FunctionArguments>
  initialProviderKeys?: Record<string, string | undefined>
  storageNamespacePrefix: string
  storageSessionId?: string
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
