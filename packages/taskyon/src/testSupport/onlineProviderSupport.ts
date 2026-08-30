import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { chatCompletionProviderSettings } from '../types/chatCompletion'
import { llmSettings } from '../types/profiles'
import { FunctionArguments } from '../types/tools'
import { TyToolchainConfig } from '../types/profiles'
import type { Taskyon, TyCoreToolSetup } from '../core/init'
import type { TaskyonStorageClient } from '../api/storageProtocol'
import type { InternalTool } from '../types/toolApi'

export type WorkflowDiagnosticsTestContext = DiagnosticsTestContext & {
  workflowDiagnosticsHost?: {
    createToolSetup: (storageClient: TaskyonStorageClient) => TyCoreToolSetup
    registerTools: (ty: Taskyon, extraTools?: InternalTool[]) => Promise<{ destroy: () => void }>
  }
}

export const resolveDiagnosticsRuntimeConfig = (context: DiagnosticsTestContext | undefined) => {
  const settings = llmSettings.safeParse(context?.llmSettings)
  const toolchainConfig =
    context?.toolchainConfig &&
    typeof context.toolchainConfig === 'object' &&
    !Array.isArray(context.toolchainConfig)
      ? (context.toolchainConfig as Record<string, unknown>)
      : undefined
  const providerSettings = chatCompletionProviderSettings.safeParse(
    toolchainConfig && 'chatCompletion' in toolchainConfig
      ? toolchainConfig.chatCompletion
      : undefined,
  )
  const fullToolchainConfig = TyToolchainConfig.safeParse(toolchainConfig)
  if (!settings.success || !providerSettings.success || !fullToolchainConfig.success) {
    return undefined
  }
  const entryNodeSettings = FunctionArguments.safeParse(
    toolchainConfig?.[settings.data.entryFunction],
  )
  return {
    settings: settings.data,
    providerSettings: providerSettings.data,
    toolchainConfig: fullToolchainConfig.data,
    ...(entryNodeSettings.success ? { entryNodeSettings: entryNodeSettings.data } : {}),
  }
}

export const authenticateDiagnosticsRuntime = async (
  context: DiagnosticsTestContext | undefined,
  runtime: {
    updateChatCompletionApiKey: (provider: string, value?: string) => Promise<void>
  },
) => (context?.providerSession ? await context.providerSession.authenticate(runtime) : false)
