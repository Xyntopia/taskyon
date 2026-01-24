import { matKeyboardReturn, matVisibility } from '@quasar/extras/material-icons'
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
  },
}

export const settingsIcons: iconMap = {
  llmSettings: {
    allowWebSearch: mdiSearchWeb,
    enableOpenAiTools: mdiFunctionVariant,
    enableToolChooser: mdiTools,
    useBasePrompt: mdiAutoFix,
    tryUsingVisionModels: matVisibility,
  },
  appConfiguration: {
    expertMode: mdiProfessionalHexagon,
    useEnterToSend: matKeyboardReturn,
  },
}
