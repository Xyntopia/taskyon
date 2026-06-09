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
    llmTools: mdiFunctionVariant,
    use_multimodal: matVisibility,
  },
  entryNode: {
    use_baseprompt: mdiAutoFix,
    use_tool_chooser: mdiTools,
    reasoning_effort: mdiHeadSnowflake,
    llmTools: mdiFunctionVariant,
    use_multimodal: matVisibility,
    max_results: mdiFormatListNumbered,
    websearch: {
      enabled: mdiSearchWeb,
      max_results: mdiFormatListNumbered,
    },
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
