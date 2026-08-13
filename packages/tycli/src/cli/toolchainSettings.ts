import { ToolchainProfiles, type EntryNodePromptTemplates } from '@taskyon/taskyon'
import bundledToolchainProfiles from '../taskyon_settings.json' with { type: 'json' }

export const CLI_FLOW_TOOL_NAME = 'cliFlow'
export const cliFlowSettings = bundledToolchainProfiles.base.cliFlow satisfies {
  prompt_templates: EntryNodePromptTemplates
}
export const cliToolchainProfiles = ToolchainProfiles.parse(bundledToolchainProfiles)
