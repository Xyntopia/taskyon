import { createStream } from '@taskyon/common/modules/frpBus'
import { createPortClient, createTaskyonClient, taskyonHostProtocol, taskyonProtocol } from '../api'
import { tyCore, type TyCoreToolSetup } from '../core/init'
import type { ChatCompletionStreamEvent } from '../types/chatCompletion'
import { createTool, toolCall } from '../types/toolApi'
import type { TyToolchainConfig } from '../types/profiles'
import { createCryptoSession } from '../utils/cryptoSession'
import { getInMemoryDatabase } from '../utils/pglite.api'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const configuredValue = (toolchainConfig: TyToolchainConfig) => {
  const value = toolchainConfig.configuredTool?.value
  if (typeof value !== 'string') throw new Error('configuredTool.value must be a string')
  return value
}

const createConfiguredTool = (toolchainConfig: TyToolchainConfig) => {
  const capturedValue = configuredValue(toolchainConfig)
  return createTool({
    name: 'configuredTool',
    description: `Configured value: ${capturedValue}`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => capturedValue,
  })
}

export const testRuntimeConfigurationRecreatesConfiguredTools = async () => {
  assert(
    !taskyonProtocol.message.safeParse({
      type: 'runtime.configureRequest',
      requestId: 'public-peer-must-not-configure-runtime',
      toolchainConfig: {},
    }).success,
    'Expected runtime configuration to remain outside the public peer protocol',
  )
  const streamEmitters = new Map<string, (event: ChatCompletionStreamEvent) => void>()
  const createConfiguredSessionTools = (toolchainConfig: TyToolchainConfig) => {
    const value = configuredValue(toolchainConfig)
    const stream = createStream<ChatCompletionStreamEvent>()
    streamEmitters.set(value, stream.emit)
    return {
      tools: [createConfiguredTool(toolchainConfig)],
      chatCompletionStream: stream.stream,
    }
  }
  const toolSetup: TyCoreToolSetup = {
    baseTools: [],
    chatCompletionToolName: 'configuredTool',
    createSessionTools: ({ toolchainConfig }) => {
      const initial = createConfiguredSessionTools(toolchainConfig)
      return {
        ...initial,
        recreateConfiguredTools: createConfiguredSessionTools,
      }
    },
  }
  const ty = await tyCore(
    () => ({
      entryFunction: 'entryNode',
    }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    {
      configuredTool: {
        value: 'initial',
      },
    },
    undefined,
    {
      indexTaskVectors: false,
      databaseFactory: getInMemoryDatabase,
      toolSetup,
    },
  )
  const client = createTaskyonClient(ty.port)
  const hostClient = createPortClient(ty.hostPort, taskyonHostProtocol)
  const streamedValues: string[] = []
  const unsubscribeChatCompletion = ty.chatCompletionStream(({ chunk }) => {
    if (chunk.type === 'text-delta') streamedValues.push(chunk.text)
  })
  const emitStreamValue = (configurationValue: string, streamValue: string) => {
    const emit = streamEmitters.get(configurationValue)
    if (!emit) throw new Error(`Expected a stream for configuration '${configurationValue}'`)
    emit({
      taskId: 'runtime-configuration-diagnostic',
      chunk: {
        type: 'text-delta',
        id: configurationValue,
        text: streamValue,
      },
    })
  }

  try {
    const initial = await client.tools.list({ includeHidden: true })
    assert(
      initial.configuredTool?.description === 'Configured value: initial',
      'Expected the tool to capture the initial configuration',
    )
    const initialInvocation = await client.tools.resolveInvocation({ name: 'configuredTool' })
    assert(initialInvocation, 'Expected the configured tool invocation to resolve')
    assert(
      initialInvocation.settingsRevision !== undefined,
      'Expected on-demand lookup to return an opaque settings revision',
    )
    emitStreamValue('initial', 'initial stream')

    await hostClient.runtime.configure({
      toolchainConfig: {
        configuredTool: {
          value: 'updated',
        },
      },
    })

    const updated = await client.tools.list({ includeHidden: true })
    assert(
      updated.configuredTool?.description === 'Configured value: updated',
      'Expected runtime.configure to recreate the configured tool',
    )
    const updatedInvocation = await client.tools.resolveInvocation({ name: 'configuredTool' })
    assert(
      updatedInvocation?.settingsRevision !== initialInvocation.settingsRevision,
      'Expected changed settings to receive a different per-tool revision',
    )
    emitStreamValue('initial', 'disconnected stream')
    emitStreamValue('updated', 'replacement stream')
    assert(
      streamedValues.join(',') === 'initial stream,replacement stream',
      'Expected runtime.configure to disconnect the old tool stream and connect its replacement',
    )

    const rejected = await hostClient.runtime.configure({
      toolchainConfig: {
        configuredTool: {
          value: 42,
        },
      },
    })
    assert(!rejected.ok, 'Expected an invalid configured tool value to reject the update')

    const afterRejectedUpdate = await client.tools.list({ includeHidden: true })
    assert(
      afterRejectedUpdate.configuredTool?.description === 'Configured value: updated',
      'Expected a rejected update to keep the previous configured tool',
    )

    await Promise.all([
      hostClient.runtime.configure({
        toolchainConfig: {
          configuredTool: {
            value: 'first queued update',
          },
        },
      }),
      hostClient.runtime.configure({
        toolchainConfig: {
          configuredTool: {
            value: 'last queued update',
          },
        },
      }),
    ])

    const afterQueuedUpdates = await client.tools.list({ includeHidden: true })
    assert(
      afterQueuedUpdates.configuredTool?.description === 'Configured value: last queued update',
      'Expected concurrent configuration commands to be applied in arrival order',
    )

    await client.tools.register({
      name: 'runtimeClientTool',
      description: 'Runtime client capability',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    })

    const initialSession = ty.getCryptoSession()
    await ty.setNewSession(await createCryptoSession())

    const afterSessionSwitch = await client.tools.list({ includeHidden: true })
    assert(
      afterSessionSwitch.configuredTool?.description === 'Configured value: last queued update',
      'Expected a new session to use the latest runtime configuration',
    )
    assert(
      afterSessionSwitch.runtimeClientTool === undefined,
      'Expected a runtime-registered client tool to remain isolated to its session',
    )

    await client.tools.register({
      name: 'runtimeClientTool',
      description: 'Runtime client capability',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    })
    const afterExplicitRegistration = await client.tools.list({ includeHidden: true })
    assert(
      afterExplicitRegistration.runtimeClientTool?.description === 'Runtime client capability',
      'Expected an external tool to become available after explicit session registration',
    )

    await ty.setNewSession(initialSession)
    const restoredInitialSession = await client.tools.list({ includeHidden: true })
    assert(
      restoredInitialSession.runtimeClientTool?.description === 'Runtime client capability',
      'Expected the original session to restore its stored external tool definition',
    )
  } finally {
    unsubscribeChatCompletion()
    await ty.dispose('runtime configuration diagnostic complete')
  }

  return { success: true }
}

testRuntimeConfigurationRecreatesConfiguredTools.description =
  'Applies runtime configuration across sessions while keeping external tool registrations session-scoped.'

export const testHostProviderCredentialsRemainPrivateAndPersistInTheSecretStore = async () => {
  assert(
    !taskyonProtocol.message.safeParse({
      type: 'providerCredentials.setRequest',
      requestId: 'public-peer-must-not-set-provider-credentials',
      provider: 'openai',
      key: 'public-leak',
    }).success,
    'Expected provider credentials to remain outside the public peer protocol',
  )

  const ty = await tyCore(
    () => ({ entryFunction: 'entryNode' }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    {},
    undefined,
    {
      indexTaskVectors: false,
      databaseFactory: getInMemoryDatabase,
      toolSetup: {
        baseTools: [],
        chatCompletionToolName: 'chatCompletion',
        createSessionTools: () => ({
          tools: [
            createTool({
              name: 'chatCompletion',
              description: 'Credential owner used by the host protocol diagnostic.',
              parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {},
              } as const,
            }),
          ],
        }),
      },
    },
  )
  const hostClient = createPortClient(ty.hostPort, taskyonHostProtocol)

  try {
    assert(
      !('updateChatCompletionApiKey' in ty),
      'Expected provider credential mutation to be available only through the host protocol',
    )
    const setResult = await hostClient.providerCredentials.set({
      provider: 'openai',
      key: 'private-provider-key',
    })
    assert(setResult.ok, 'Expected the private host credential command to succeed')

    const secretIds = await ty.listSecretIds()
    assert(secretIds.length === 1, 'Expected the provider key to use the chat tool secret owner')
    assert(
      (await ty.getSecret(secretIds[0]!, 'openai', false)) === 'private-provider-key',
      'Expected the provider credential to be stored through Taskyon secret storage',
    )

    const deleteResult = await hostClient.providerCredentials.set({ provider: 'openai' })
    assert(deleteResult.ok, 'Expected deleting a provider key through the host protocol to succeed')
    assert(
      (await ty.getSecret(secretIds[0]!, 'openai', false)) === null,
      'Expected the provider credential to be removed from Taskyon secret storage',
    )
  } finally {
    await ty.dispose('host provider credential diagnostic complete')
  }
}

testHostProviderCredentialsRemainPrivateAndPersistInTheSecretStore.description =
  'Stores provider credentials through the private host protocol without widening the public peer API.'
