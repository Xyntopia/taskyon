import type { FunctionArguments, llmSettings, partialTaskDraft } from '@taskyon/taskyon'
import type { TaskyonCoreRuntimeStage } from './core'
import type { TaskyonBrowserProviderTransport, TaskyonDirectFallbackRequest } from './providerFetch'

export type TaskyonBrowserWorkerInitMessage = {
  type: 'init'
  corePort: MessagePort
  hostPort: MessagePort
  storagePort: MessagePort
  /** Additive local-worker capability for forwarding existing core streams. */
  chatCompletionStreamPort?: MessagePort
  workerStreamPort?: MessagePort
  llmSettings: llmSettings
  entryNode?: partialTaskDraft
  toolchainConfig?: Record<string, FunctionArguments>
  providerTransport?: TaskyonBrowserProviderTransport
  directFallbackPort?: MessagePort
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

export type TaskyonDirectFallbackPortMessage =
  | {
      type: 'request'
      id: string
      request: TaskyonDirectFallbackRequest
    }
  | {
      type: 'response'
      id: string
      approved: boolean
    }
