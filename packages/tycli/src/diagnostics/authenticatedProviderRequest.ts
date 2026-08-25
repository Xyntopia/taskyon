import type { DiagnosticsProviderSession } from '@taskyon/common/modules/diagnosticsRunner'
import type { ChatCompletionProviderSettings } from '@taskyon/taskyon'
import { buildChatProviderRequest } from '@taskyon/taskyon/tools/chatCompletion/providerRequest'

export const createAuthenticatedProviderRequestBuilder = async (
  session: DiagnosticsProviderSession,
  api: ChatCompletionProviderSettings,
) => {
  let credential: string | undefined
  const authenticated = await session.authenticate({
    updateChatCompletionApiKey: (provider, value) => {
      if (provider !== api.provider) {
        throw new Error(`Authenticated provider ${provider} does not match ${api.provider}.`)
      }
      credential = value
      return Promise.resolve()
    },
  })
  if (!authenticated || !credential) return null
  const providerCredential = credential

  return async (args: Omit<Parameters<typeof buildChatProviderRequest>[0], 'api' | 'apiKey'>) =>
    await buildChatProviderRequest({ ...args, api, apiKey: providerCredential })
}
