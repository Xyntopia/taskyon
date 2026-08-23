import {
  matGradient,
  matKeyboardReturn,
  matTexture,
  matVisibility,
} from '@quasar/extras/material-icons'
import {
  mdiAutoFix,
  mdiFormatListNumbered,
  mdiHeadSnowflake,
  mdiProfessionalHexagon,
  mdiSearchWeb,
  mdiStrategy,
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
    pinnedTools: mdiTools,
    toolSearchEnabled: mdiTools,
    recentToolCount: mdiFormatListNumbered,
    frequentToolCount: mdiFormatListNumbered,
    recentSearchToolCount: mdiFormatListNumbered,
    max_error_retries: mdiFormatListNumbered,
    reasoning_effort: mdiHeadSnowflake,
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
    researchMode: mdiStrategy,
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
