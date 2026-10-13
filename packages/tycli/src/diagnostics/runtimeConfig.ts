import { chatCompletionProviderSettings } from '../../../taskyon/src/types/chatCompletion'
import {
  llmSettings,
  resolveToolchainConfig,
  ToolchainProfiles,
} from '../../../taskyon/src/types/profiles'
import { readFile } from 'node:fs/promises'
import z from 'zod'

export const loadDiagnosticsRuntimeConfig = async (
  path: string,
  provider?: string,
  model?: string,
) => {
  const config = z
    .object({
      llmSettings,
      toolchainProfiles: ToolchainProfiles,
      selectedToolchainProfile: z.string(),
    })
    .parse(JSON.parse(await readFile(path, 'utf8')))
  const toolchainConfig = resolveToolchainConfig(
    config.toolchainProfiles,
    config.selectedToolchainProfile,
  )
  const selected = chatCompletionProviderSettings.parse(toolchainConfig.chatCompletion)
  if (provider && provider !== selected.provider) {
    throw new Error('--provider conflicts with the diagnostic runtime configuration')
  }
  if (model && model !== selected.model) {
    throw new Error('--model conflicts with the diagnostic runtime configuration')
  }
  return {
    llmSettings: config.llmSettings,
    toolchainConfig,
    provider: selected.provider,
    model: selected.model,
  }
}
