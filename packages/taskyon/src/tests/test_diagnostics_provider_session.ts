import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { authenticateDiagnosticsRuntime } from '../testSupport/onlineProviderSupport'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testDiagnosticsProviderSessionAuthenticatesRuntimeWithoutRawContextKey = async () => {
  const context: DiagnosticsTestContext = {
    providerSession: {
      provider: 'fixture-provider',
      authenticate: async (runtime) => {
        await runtime.updateChatCompletionApiKey('fixture-provider', 'fixture-credential')
        return true
      },
    },
  }
  let installed = false
  const authenticated = await authenticateDiagnosticsRuntime(context, {
    updateChatCompletionApiKey: (provider, value) => {
      installed = provider === 'fixture-provider' && value === 'fixture-credential'
      return Promise.resolve()
    },
  })

  assert(authenticated && installed, 'Expected the provider session to authenticate the runtime')
  assert(!('providerKey' in context), 'Diagnostics context must not expose a raw provider key')
}

testDiagnosticsProviderSessionAuthenticatesRuntimeWithoutRawContextKey.description =
  'Authenticates a diagnostics runtime through the provider-session capability without a raw context key.'
