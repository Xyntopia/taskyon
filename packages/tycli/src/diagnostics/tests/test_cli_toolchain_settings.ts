import { readFileSync } from 'node:fs'
import {
  createCliLlmState,
  fetchProviderModels,
  getSelectedReasoningEffort,
  getSelectedToolchainConfig,
  setReasoningEffort,
} from '../../cli/models'
import { DEFAULT_CLI_UNAVAILABLE_TOOL_NAMES } from '../../cli'
import { CLI_FLOW_TOOL_NAME, cliToolchainProfiles } from '../../cli/toolchainSettings'
import { chatCompletionProviderSettings } from '../../../../taskyon/src/types/chatCompletion'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testCliUsesCompleteCliFlowToolchainSettings = () => {
  const state = createCliLlmState(
    { selectedApi: 'openai', model: 'configured-model' },
    cliToolchainProfiles,
    CLI_FLOW_TOOL_NAME,
  )
  const selected = getSelectedToolchainConfig(state)
  const cliFlow = selected.cliFlow

  assert(state.settings.entryFunction === 'cliFlow', 'Expected cliFlow as the CLI entry function')
  assert(cliFlow !== undefined, 'Expected CLI flow settings in the resolved toolchain profile')
  assert(
    typeof cliFlow.prompt_templates === 'object' &&
      cliFlow.prompt_templates !== null &&
      !Array.isArray(cliFlow.prompt_templates),
    'Expected CLI prompt templates in the shipped toolchain declaration',
  )
  const promptTemplates = cliFlow.prompt_templates
  for (const field of ['basePrompt', 'message', 'toolResult', 'error', 'retryExhausted'] as const) {
    assert(
      typeof promptTemplates[field] === 'string' && promptTemplates[field].length > 0,
      `Expected a non-empty CLI ${field} prompt template`,
    )
  }
  assert(
    JSON.stringify(promptTemplates) ===
      JSON.stringify(cliToolchainProfiles.base.cliFlow?.prompt_templates),
    'Expected the resolved prompts to match the shipped CLI declaration without injected policy text',
  )
  assert(
    selected.chatCompletion?.model === 'configured-model',
    'Expected the selected model to override the shipped provider model',
  )
  assert(
    getSelectedReasoningEffort(state) === 'low',
    'Expected the bundled CLI reasoning effort to be preserved',
  )
}

testCliUsesCompleteCliFlowToolchainSettings.description =
  'Resolves complete CLI flow prompts and provider settings through one ToolchainProfiles declaration.'

export const testCliShipsOpenCodeGoProviderProfile = () => {
  const provider = cliToolchainProfiles.profiles['opencode-go']?.chatCompletion
  assert(provider !== undefined, 'Expected the bundled OpenCode Go CLI provider profile')
  assert(provider.provider === 'opencode-go', 'Expected the OpenCode Go provider identifier')
  assert(
    provider.baseURL === 'https://opencode.ai/inference/go',
    'Expected the OpenCode Go inference endpoint',
  )
  assert(
    provider.routes.chatCompletion === '/v1/' && provider.routes.models === '/v1/models',
    'Expected the OpenAI-compatible OpenCode Go routes',
  )
  assert(
    provider.sessionHeader === 'x-opencode-session',
    'Expected the OpenCode Go conversation session header',
  )
  assert(provider.auth?.type === 'apikey', 'Expected API-key authentication for OpenCode Go')
}

testCliShipsOpenCodeGoProviderProfile.description =
  'Ships the OpenCode Go endpoint as an API-key provider profile for the CLI.'

const readBrowserProviderProfile = (name: string) => {
  const settings = JSON.parse(
    readFileSync(
      new URL('../../../../../src/assets/taskyon_settings.json', import.meta.url),
      'utf8',
    ),
  ) as { toolchainProfiles?: { profiles?: Record<string, { chatCompletion?: unknown }> } }
  const profile = settings.toolchainProfiles?.profiles?.[name]?.chatCompletion
  assert(profile !== undefined, `Expected the bundled ${name} browser provider profile`)
  return chatCompletionProviderSettings.parse(profile)
}

export const testBrowserShipsOpenCodeGoProviderProfile = () => {
  const provider = readBrowserProviderProfile('opencode-go')

  assert(provider.provider === 'opencode-go', 'Expected the OpenCode Go provider identifier')
  assert(
    provider.recommendedTransport === 'wss',
    'Expected the browser profile to recommend WSS because direct browser chat is blocked by CORS',
  )
  assert(
    provider.baseURL === 'https://opencode.ai/inference/go',
    'Expected the OpenCode Go inference endpoint',
  )
  assert(
    provider.routes.chatCompletion === '/v1/' && provider.routes.models === '/v1/models',
    'Expected the OpenAI-compatible OpenCode Go routes',
  )
  assert(
    provider.sessionHeader === 'x-opencode-session',
    'Expected the OpenCode Go conversation session header',
  )
}

testBrowserShipsOpenCodeGoProviderProfile.description =
  'Ships the OpenCode Go browser profile with the WSS route and session header.'

export const testBrowserShipsOpenCodeZenModelRoute = () => {
  const provider = readBrowserProviderProfile('opencode')
  assert(
    provider.routes.models === 'https://opencode.ai/inference/v1/models',
    'Expected the Zen model list at the inference root rather than the OpenAI family path',
  )
}

testBrowserShipsOpenCodeZenModelRoute.description =
  'Points the OpenCode Zen profile at the public model list under the inference root.'

export const testOpenCodeModelListsLoadWithoutKey = async () => {
  const zen = readBrowserProviderProfile('opencode')
  const go = readBrowserProviderProfile('opencode-go')
  const zenModels = await fetchProviderModels('opencode', zen, '', { forceRefresh: true })
  const goModels = await fetchProviderModels('opencode-go', go, '', { forceRefresh: true })

  assert(zenModels['glm-5.3-flash-free'] !== undefined, 'Expected the Zen model list')
  assert(goModels['deepseek-v4.1-flash'] !== undefined, 'Expected the OpenCode Go model list')
  assert(Object.keys(zenModels).length > 1, 'Expected more than one Zen model')
  assert(Object.keys(goModels).length > 1, 'Expected more than one OpenCode Go model')
  return { zen: Object.keys(zenModels).length, go: Object.keys(goModels).length }
}

testOpenCodeModelListsLoadWithoutKey.description =
  'Fetches the public OpenCode and OpenCode Go model lists without an API key.'

export const testCliModelOverridesDoNotMutateShippedProfiles = () => {
  createCliLlmState(
    { selectedApi: 'openai', model: 'temporary-model' },
    cliToolchainProfiles,
    CLI_FLOW_TOOL_NAME,
  )
  const fresh = createCliLlmState(
    { selectedApi: 'openai' },
    cliToolchainProfiles,
    CLI_FLOW_TOOL_NAME,
  )

  assert(
    getSelectedToolchainConfig(fresh).chatCompletion?.model === 'gpt-5.1',
    'Expected a fresh CLI state to retain the shipped provider model',
  )
}

testCliModelOverridesDoNotMutateShippedProfiles.description =
  'Clones the shipped CLI toolchain declaration before applying persisted provider and model choices.'

export const testCliReasoningEffortCanBeChangedWithoutMutatingShippedProfiles = () => {
  const state = createCliLlmState(
    { selectedApi: 'openai' },
    cliToolchainProfiles,
    CLI_FLOW_TOOL_NAME,
  )
  setReasoningEffort(state, 'high')

  assert(getSelectedReasoningEffort(state) === 'high', 'Expected the selected effort to update')
  const fresh = createCliLlmState(
    { selectedApi: 'openai' },
    cliToolchainProfiles,
    CLI_FLOW_TOOL_NAME,
  )
  assert(
    getSelectedReasoningEffort(fresh) === 'low',
    'Expected changing one CLI state to leave the shipped default unchanged',
  )
}

testCliReasoningEffortCanBeChangedWithoutMutatingShippedProfiles.description =
  'Updates CLI reasoning effort through the toolchain config boundary without mutating bundled settings.'

export const testCliExcludesBrowserMcpBootstrapTools = () => {
  for (const toolName of ['ensureBrowserMcpTools', 'importBrowserMcpTools']) {
    assert(
      DEFAULT_CLI_UNAVAILABLE_TOOL_NAMES.has(toolName),
      `Expected the CLI to exclude browser-only tool ${toolName}`,
    )
  }
  return { excluded: ['ensureBrowserMcpTools', 'importBrowserMcpTools'] }
}

testCliExcludesBrowserMcpBootstrapTools.description =
  'Keeps browser MCP onboarding tools out of the terminal CLI tool window.'
