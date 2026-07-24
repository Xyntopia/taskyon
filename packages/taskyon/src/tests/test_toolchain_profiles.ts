import {
  getToolchainProviderProfiles,
  resolveToolchainConfig,
  resolveToolchainProvider,
  updateToolchainConfigValue,
  type ToolchainProfiles,
} from '../types/profiles'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testToolchainProfilesResolveBaseWithoutSelection = () => {
  const toolchainProfiles = {
    base: {
      chatCompletion: {
        model: 'base-model',
        headers: { source: 'base' },
      },
    },
    profiles: {},
  } satisfies ToolchainProfiles

  const resolved = resolveToolchainConfig(toolchainProfiles)
  const chatCompletion = resolved.chatCompletion
  assert(
    chatCompletion && typeof chatCompletion === 'object' && !Array.isArray(chatCompletion),
    'Expected base chatCompletion settings',
  )
  const headers = chatCompletion.headers
  assert(headers && typeof headers === 'object' && !Array.isArray(headers), 'Expected base headers')

  headers.source = 'changed-result'

  assert(
    toolchainProfiles.base.chatCompletion.headers.source === 'base',
    'Expected base-only result mutation not to affect the stored base profile',
  )

  return { success: true }
}

testToolchainProfilesResolveBaseWithoutSelection.description =
  'Resolves an independent copy of base settings when no toolchain profile is selected.'

export const testToolchainProfilesResolveSelectedProfile = () => {
  const toolchainProfiles = {
    base: {
      chatCompletion: {
        model: 'base-model',
        headers: { shared: 'base', baseOnly: 'base' },
        tools: ['base-tool'],
        nullable: 'base',
      },
      sharedTool: {
        enabled: true,
      },
    },
    profiles: {
      research: {
        chatCompletion: {
          model: 'research-model',
          headers: { shared: 'profile', profileOnly: 'profile' },
          tools: ['research-tool'],
          nullable: null,
        },
        researchPlanner: {
          maxSources: 5,
        },
      },
    },
  } satisfies ToolchainProfiles

  const resolved = resolveToolchainConfig(toolchainProfiles, 'research')
  const chatCompletion = resolved.chatCompletion
  assert(
    chatCompletion && typeof chatCompletion === 'object' && !Array.isArray(chatCompletion),
    'Expected resolved chatCompletion settings',
  )
  const headers = chatCompletion.headers
  assert(
    headers && typeof headers === 'object' && !Array.isArray(headers),
    'Expected recursively merged headers',
  )

  assert(chatCompletion.model === 'research-model', 'Expected the selected profile model to win')
  assert(headers.shared === 'profile', 'Expected the selected profile nested value to win')
  assert(headers.baseOnly === 'base', 'Expected the base nested value to remain')
  assert(
    headers.profileOnly === 'profile',
    'Expected the selected profile nested value to be added',
  )
  assert(
    Array.isArray(chatCompletion.tools) &&
      chatCompletion.tools.length === 1 &&
      chatCompletion.tools[0] === 'research-tool',
    'Expected selected profile arrays to replace base arrays',
  )
  assert(chatCompletion.nullable === null, 'Expected null to remain an ordinary overriding value')
  assert(resolved.sharedTool?.enabled === true, 'Expected arbitrary base tool settings to remain')
  assert(
    resolved.researchPlanner?.maxSources === 5,
    'Expected arbitrary selected-profile tool settings to be added',
  )

  headers.shared = 'changed-result'
  chatCompletion.tools.push('changed-result')

  assert(
    toolchainProfiles.base.chatCompletion.headers.shared === 'base',
    'Expected result mutation not to affect base nested objects',
  )
  assert(
    toolchainProfiles.profiles.research.chatCompletion.headers.shared === 'profile',
    'Expected result mutation not to affect selected-profile nested objects',
  )
  assert(
    toolchainProfiles.profiles.research.chatCompletion.tools.length === 1,
    'Expected result mutation not to affect selected-profile arrays',
  )

  return { success: true }
}

testToolchainProfilesResolveSelectedProfile.description =
  'Resolves a selected toolchain profile over common base settings without sharing mutable data.'

export const testToolchainProfilesRejectUnknownSelection = () => {
  const toolchainProfiles = {
    base: {},
    profiles: {
      research: {},
    },
  } satisfies ToolchainProfiles

  let error: unknown
  try {
    resolveToolchainConfig(toolchainProfiles, 'missing')
  } catch (cause) {
    error = cause
  }

  assert(error instanceof Error, 'Expected an unknown selected profile to throw')
  assert(
    error.message.includes('missing'),
    'Expected the unknown-profile error to identify the missing profile',
  )

  return { success: true }
}

testToolchainProfilesRejectUnknownSelection.description =
  'Rejects a selected toolchain profile that is not defined.'

export const testToolchainProfileWritesFollowCurrentOwner = () => {
  const toolchainProfiles = {
    base: {
      entryNode: {
        reasoning_effort: 'medium',
        websearch: { max_results: 5 },
      },
    },
    profiles: {
      research: {
        entryNode: {
          reasoning_effort: 'high',
        },
      },
    },
  } satisfies ToolchainProfiles

  const withProfileSetting = updateToolchainConfigValue(
    toolchainProfiles,
    'research',
    ['entryNode', 'reasoning_effort'],
    'low',
  )
  const withBaseSetting = updateToolchainConfigValue(
    withProfileSetting,
    'research',
    ['entryNode', 'websearch', 'max_results'],
    10,
  )

  assert(
    withBaseSetting.profiles.research?.entryNode?.reasoning_effort === 'low',
    'Expected an existing selected-profile path to remain provider-specific',
  )
  assert(
    withBaseSetting.base.entryNode?.websearch !== null &&
      typeof withBaseSetting.base.entryNode?.websearch === 'object' &&
      !Array.isArray(withBaseSetting.base.entryNode.websearch) &&
      withBaseSetting.base.entryNode.websearch.max_results === 10,
    'Expected a path absent from the selected profile to update base',
  )
  assert(
    toolchainProfiles.profiles.research.entryNode.reasoning_effort === 'high' &&
      toolchainProfiles.base.entryNode.websearch.max_results === 5,
    'Expected profile updates not to mutate the input profiles',
  )

  return { success: true }
}

testToolchainProfileWritesFollowCurrentOwner.description =
  'Writes settings to the profile that currently owns the exact setting path.'

const providerSettings = (provider: string, model: string) => ({
  provider,
  name: provider,
  model,
  baseURL: `https://${provider}.example`,
  streamSupport: true,
  routes: {
    chatCompletion: '/v1/',
    models: '/v1/models',
  },
})

export const testToolchainProviderProfiles = () => {
  const toolchainProfiles = {
    base: {
      chatCompletion: {
        timeouts: { totalMs: 60_000 },
      },
    },
    profiles: {
      openai: {
        chatCompletion: providerSettings('openai', 'gpt-test'),
      },
      research: {
        entryNode: { reasoning_effort: 'high' },
      },
    },
  } satisfies ToolchainProfiles

  const providers = getToolchainProviderProfiles(toolchainProfiles)
  const selected = resolveToolchainProvider(toolchainProfiles, 'openai')

  assert(Object.keys(providers).length === 1, 'Expected only provider profiles to be returned')
  assert(providers.openai?.model === 'gpt-test', 'Expected the provider model from the profile')
  assert(selected.provider === 'openai', 'Expected the selected provider ID')
  assert(selected.model === 'gpt-test', 'Expected the selected profile model')

  return { success: true }
}

testToolchainProviderProfiles.description =
  'Discovers provider profiles and resolves the selected chatCompletion provider configuration.'

export const testProviderProfileRetainsAttributionHeaders = () => {
  const settings = {
    ...providerSettings('openrouter.ai', 'gpt-test'),
    defaultHeaders: {
      'HTTP-Referer': 'https://taskyon.space',
      'X-Title': 'Taskyon',
    },
  }
  const toolchainProfiles = {
    base: {},
    profiles: {
      'openrouter.ai': { chatCompletion: settings },
    },
  } satisfies ToolchainProfiles
  const provider = resolveToolchainProvider(toolchainProfiles, 'openrouter.ai')
  assert(
    provider.defaultHeaders?.['HTTP-Referer'] === 'https://taskyon.space',
    'Expected provider-specific attribution headers',
  )

  return { success: true }
}

testProviderProfileRetainsAttributionHeaders.description =
  'Keeps service-specific attribution headers in the owning provider profile.'
