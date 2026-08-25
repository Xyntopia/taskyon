import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { chatCompletionProviderSettings } from '../types/chatCompletion'
import { llmSettings } from '../types/profiles'
import { FunctionArguments } from '../types/tools'

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
  if (!settings.success || !providerSettings.success) return undefined
  const entryNodeSettings = FunctionArguments.safeParse(
    toolchainConfig?.[settings.data.entryFunction],
  )
  return {
    settings: settings.data,
    providerSettings: providerSettings.data,
    ...(entryNodeSettings.success ? { entryNodeSettings: entryNodeSettings.data } : {}),
  }
}

export const authenticateDiagnosticsRuntime = async (
  context: DiagnosticsTestContext | undefined,
  runtime: {
    updateChatCompletionApiKey: (provider: string, value?: string) => Promise<void>
  },
) => (context?.providerSession ? await context.providerSession.authenticate(runtime) : false)
