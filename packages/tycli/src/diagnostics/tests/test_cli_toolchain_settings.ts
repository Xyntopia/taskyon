import {
  createCliLlmState,
  getSelectedReasoningEffort,
  getSelectedToolchainConfig,
  setReasoningEffort,
} from '../../cli/models'
import { CLI_FLOW_TOOL_NAME, cliToolchainProfiles } from '../../cli/toolchainSettings'

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
  for (const field of [
    'basePrompt',
    'message',
    'toolResult',
    'error',
    'toolChooser',
    'retryExhausted',
  ] as const) {
    assert(
      typeof promptTemplates[field] === 'string' && promptTemplates[field].length > 0,
      `Expected a non-empty CLI ${field} prompt template`,
    )
  }
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
