import {
  matGradient,
  matKeyboardReturn,
  matTexture,
  matVisibility,
} from '@quasar/extras/material-icons'
import {
  mdiAutoFix,
  mdiFormatListNumbered,
  mdiFunctionVariant,
  mdiHeadSnowflake,
  mdiProfessionalHexagon,
  mdiSearchWeb,
  mdiTools,
} from '@quasar/extras/mdi-v6'

export type iconMap = {
  [key: string]: string | iconMap
}

export const iconRegistry: iconMap = {
  chatCompletion: {
    reasoning_effort: mdiHeadSnowflake,
    max_results: mdiFormatListNumbered,
    use_multimodal: matVisibility,
  },
  entryNode: {
    use_baseprompt: mdiAutoFix,
    use_tool_chooser: mdiTools,
    tool_chooser_min_tools: mdiFormatListNumbered,
    max_error_retries: mdiFormatListNumbered,
    reasoning_effort: mdiHeadSnowflake,
    providerToolCalling: mdiFunctionVariant,
    use_multimodal: matVisibility,
    max_results: mdiFormatListNumbered,
    websearch: {
      enabled: mdiSearchWeb,
      max_results: mdiFormatListNumbered,
    },
  },
  importBrowserMcpTools: {
    serverUrl: mdiSearchWeb,
    toolNames: mdiTools,
  },
  ensureBrowserMcpTools: {
    serverUrl: mdiSearchWeb,
    toolNames: mdiTools,
    startupInstructions: mdiTools,
  },
  webResearchPlanner: {
    searchQueries: mdiSearchWeb,
    browserTools: mdiTools,
    supportTools: mdiTools,
    maxSourcesPerQuery: mdiFormatListNumbered,
    webSearchMaxResults: mdiFormatListNumbered,
  },
  proxyWebReader: {
    providerPreset: mdiTools,
    serviceUrl: mdiSearchWeb,
  },
}

export const settingsIcons: iconMap = {
  llmSettings: {},
  appConfiguration: {
    webSearchButton: mdiSearchWeb,
    expertMode: mdiProfessionalHexagon,
    useEnterToSend: matKeyboardReturn,
    primaryColor: matTexture,
    secondaryColor: matGradient,
  },
}
