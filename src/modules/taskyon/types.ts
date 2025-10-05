import {
  matKeyboardReturn,
  matSmartToy,
  matVisibility,
  matVisibilityOff,
} from '@quasar/extras/material-icons'
import {
  mdiAlphabeticalVariant,
  mdiAutoFix,
  mdiFunctionVariant,
  mdiProfessionalHexagon,
  mdiTools,
} from '@quasar/extras/mdi-v6'
import type { TaskNode } from '@taskyon/taskyon'
import { apiConfig, partialTaskDraft } from '@taskyon/taskyon'
import { z } from 'zod'

export const taskTemplateTypes = {
  toolDescription: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { type: 'message', data: 'Tool Description here!' },
      role: 'system',
      label: ['function'],
    }),
  file: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { type: 'files', data: [] },
      role: 'system',
      label: ['files'],
    }),
  /*file: partialTaskDraft.required({role: true, label: true})
  .merge(TaskNode['configuration']).default({
    role: 'system',
    configuration: {
      message: "test"
    },
    label: ['file']
  })*/
}

export const llmSettings = z.object({
  userId: z.string().nullish().optional().meta({
    description:
      'a (public) cryptographic user id which is used to identify the user in different chats',
  }),
  secretPublicKey: z.string().nullish().optional().meta({
    description: 'A (public) cryptographic key which is used to encrypt secrets',
  }),
  selectedTaskId: z.string().optional().meta({
    description:
      'The currently selected conversation defined by the ID of its last node. The task chain is defined through each tasknodes parent IDs',
  }),
  enableOpenAiTools: z
    .boolean()
    .default(false)
    .meta({
      onIcon: matSmartToy,
      offIcon: 'svguse:/taskyon_mono_opt.svg#taskyon',
      icon: mdiFunctionVariant,
      label: 'Native Agent Tools',
      description: `### Enable native AI function selection.

If this is enabled Taskyon will try to
leverage the native tool selection functionality of AI models.
Turning this off is usually recommended in order to use Taskyons model-agnostic mechanisms.

This doesn't work for all models currently and is mainly recommended for all openAI models.

For more information check this link: https://platform.openai.com/docs/guides/function-calling`,
    }),
  selectedApi: z.string().nullish().default('taskyon').meta({
    description: 'which of the defined APIs are we currently using?',
  }),
  llmApis: z.record(z.string(), apiConfig).default({}).meta({
    description: 'A list of OpenAI compatible API definitions.',
  }),
  siteUrl: z.string().default('https://taskyon.space').meta({
    description:
      'wha is the URL of this page?. This helps identifying Backends, where the request is coming from.',
  }),
  summaryModel: z.string().default('Xenova/distilbart-cnn-6-6').meta({
    description: 'Which model are we using for local summary?',
  }),
  vectorizationModel: z.string().default('Xenova/all-MiniLM-L6-v2').meta({
    description: 'Which model should be used for vectorization?',
  }),
  maxAutonomousTasks: z.number().default(3).meta({
    description:
      'Maximum number of tasks which are allowed to be performed autonomously before stopping.',
  }),
  entryNode: partialTaskDraft.optional().meta({
    description: `A task template which is used as an entry node for taskyon.
When a user starts a conversation, this is always the first task that is called.

If none is specified, the "chooseTool" tool is used for tool calls and
simple chatCompletion for non-tool calls.
`,
  }),
  enableToolChooser: z.boolean().default(true).meta({
    description:
      'Enable the standard tool chooser. This function enables taskyon to decide if and then which tool it should use for the task.',
    icon: mdiTools,
    label: 'Use Tools',
  }),
  useBasePrompt: z
    .boolean()
    .default(true)
    .meta({
      offIcon: mdiAlphabeticalVariant,
      icon: mdiAutoFix,
      label: 'Fancy AI',
      description: `
  *Toggle the base prompt on/off.*

  This gives the AI instructions how to draw better graphics, math
  formulas and generally make the chat a little more fancy than just plain
  text. You can check/change the base prompt in the settings...`,
    }),
  tryUsingVisionModels: z.boolean().default(true).meta({
    icon: matVisibility,
    offIcon: matVisibilityOff,
    label: 'Vision',
    description:
      'Toggle Vision ON/OFF. If a model supports vision, we will try to use that for uploaded images',
  }),
  taskChatTemplates: z
    .object({
      basePrompt: z.string().meta({
        description:
          'The base prompt. This should be used e.g. to set the behaviour of the AI. used as a "system" prompt.',
      }),
      instruction: z.string().meta({
        description: 'This prompt is used to make the AI follow instructions',
      }),
      toolResult: z.string().meta({
        description:
          'This prompt is used to make the AI display tool results in a certain structured way.',
      }),
      task: z.string().meta({
        description: 'This prompt is used to explain to the AI what to do with a specific task.',
      }),
      evaluate: z.string().meta({
        description: 'This prompt is used to evaluate errors',
      }),
      schemaReminder: z.string().meta({
        description: 'This prompt is used to enforce a specific schema as a response...',
      }),
      tools: z.string().meta({
        description: 'This prompt is used to give the AI a list of tools.',
      }),
    })
    .meta({
      description:
        'These are the definitions of the prompts which are used in chats for different purposes.',
    }),
})
export type llmSettings = z.infer<typeof llmSettings>

/* ───────────────────────────────
   Tool-chain level configuration
   ─────────────────────────────── */
export const TyToolchainConfig = z.object({
  tools: z
    .record(z.string(), z.json())
    .default({})
    .describe(
      'Settings for a single tool. The tool ID is the ID of the tasknode where the tool is defined.',
    ),
}).describe(`All tool parameters can be turned into settings as well. This makes taskyons
configuration very adaptable to new tools.
Taskyon lets you configure each tool with optional defaut values.
Taskyon provides the option of letting profiles partially be overriden by each other.`)

export type TyToolchainConfig = z.infer<typeof TyToolchainConfig>

const hexColorRegex = /^#([A-Fa-f0-9]{6})$/
const HexColor = z
  .string()
  .superRefine((value, ctx) => {
    if (!hexColorRegex.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid hexadecimal color',
      })
    }
  })
  .meta({ format: 'color', description: 'Must be a 6‑digit hex color, e.g. #00FFAA' })

type HexColor = z.infer<typeof HexColor>

// rename to TyAppConfig
export const appConfiguration = z.object({
  darkTheme: z
    .union([z.literal('auto'), z.boolean()])
    .meta({ description: 'Explicitly set the taskyon dark mode' }),
  appConfigurationUrl: z.string().default('/taskyon_settings.json').meta({
    description: 'URL from which to load the initial app configuration',
  }),
  gdriveConfigurationFile: z.string().default('taskyon_settings.json').meta({
    description: 'gDrive fileid of the configuration',
  }),
  enableGdriveSync: z.boolean().default(false).optional(),
  expertMode: z.boolean().default(false).meta({
    icon: mdiProfessionalHexagon,
    label: 'Expert Mode',
    description:
      'Turn on additional settings and configurations and debugging tools for advanced users.',
  }),
  showCosts: z.boolean().default(false).meta({
    description: 'Shows the costs of API calls.',
  }),
  gdriveDir: z.string().default('taskyon').meta({
    description: 'The default directory in gdrive, where taskyon saves its configuration.',
  }), // not sure, if we need this here?
  showLogo: z
    .boolean()
    .default(true)
    .meta({ description: 'Show a logo when now chat is selected' })
    .optional(),
  welcomeMsg: z
    .string()
    .default('')
    .meta({ description: 'A little message displayed when no chat is selected' })
    .optional(),
  chatSuggestions: z
    .array(
      z.union([
        z.object({ url: z.string(), label: z.string() }).meta({
          description:
            'Use url and label which point toa  markdown file which you want to use as a chat template!',
        }),
        z
          .object({ md: z.string(), label: z.string() })
          .meta({ description: 'Use a markdown string which will be used as a chat template.' }),
      ]),
    )
    .default([])
    .optional()
    .meta({
      description:
        'A list of getting started templates which appear as buttons when no chat is selected.',
    }),
  useEnterToSend: z
    .enum(['auto', 'on', 'off', 'shift'])
    .default('auto')
    .meta({
      icon: matKeyboardReturn,
      label: 'Use Enter to Send',
      description: `Controls the behavior of the Enter key for sending messages.
  "Auto" enables sending messages with Enter on desktop devices while disabling it on mobile devices.
  Other options allow always enabling, always disabling, or requiring Shift+Enter to insert a new line.`,
    }),
  guiMode: z.enum(['auto', 'iframe', 'default', 'minChat']).default('auto').meta({
    description: 'Sets whether we want to have a minimalist chat or the full app',
  }),
  primaryColor: HexColor.meta({
    description: 'Primary color for custom taskyon theming. This should be a dark color',
  })
    .default('#2A3548')
    .optional(),
  secondaryColor: HexColor.meta({
    description:
      'Secondary color for custom taskyon theming. This color should be a bright color and contrast the primary color.',
  })
    .default('#F78F3B')
    .optional(),
})
export type appConfiguration = z.infer<typeof appConfiguration>

export const TyProfile = z.object({
  version: z.literal(21).meta({
    description:
      'whenever the schema of the settings change, this number will get changed as well...',
  }),
  appConfiguration,
  llmSettings,
  toolchainConfig: TyToolchainConfig,
  signatureOrKey: z.string().optional()
    .describe(`By specifying a signature it is possible to circumvent
usage of an API key. This way you can give your users access to taskyon with your own restrictions.`),
}).describe(`This is a taskyon profile which can be used to configure taskyon for different tasks.

This could for example mean to provide different service providers or different default
LLM models and other settings for tools.
`)
export type TyProfile = z.infer<typeof TyProfile>

export const tyPublicKeyDraft = z.object({
  name: z
    .string()
    .meta({
      description: 'Name of the key.',
    })
    .optional(),
  maxc: z
    .number()
    .meta({
      description: 'Maximum allowed credits in this key',
    })
    .optional(),
  cpi: z.number().meta({
    description: 'Credit refill per inteval',
  }),
  rti: z.number().meta({
    description: 'Refill time interval in minutes',
  }),
  model: z
    .string()
    .array()
    .meta({
      description: 'List of models which are allowed with this key.',
    })
    .optional(),
})

export type tyPublicKeyDraft = z.infer<typeof tyPublicKeyDraft>

export const tyPublicApiKeyObject = tyPublicKeyDraft.extend({
  iat: z.number().meta({
    description: 'Time at which the key was issued.',
    format: 'timestamp',
  }),
  auid: z.string().meta({
    description: 'anonymous User ID for billing purposes.',
  }),
  v: z.number().meta({
    description: 'Key version',
  }),
  iss: z.string().meta({
    description: 'The Issuer of the API key.',
  }),
})
export function getApiConfig(llmSettings: llmSettings) {
  if (llmSettings.selectedApi) {
    return llmSettings.llmApis[llmSettings.selectedApi]
  }
}

export function getCurrentModel(api: apiConfig) {
  return api.selectedModel || api.defaultModel || api.models?.free || 'No model selected!'
}

export interface TyTaskStreamData {
  info?: string
  task?: TaskNode | null | undefined
  taskId?: string | null | undefined
  // "all finished" means the task has been processes AND all its subtasks have been finished..
  stage:
    | 'in loop' // task is put it the loop in order to check if it has subtasks
    | 'processing' // means, the task enters the loop of processing
    | 'processed'
    | 'error'
    | 'waiting'
    | 'subtasks'
    | 'all finished'
    | 'aborted'
    | 'queued'
}

export const OAuthCredentials = z.object({
  type: z.enum(['oauth-credentials']),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  service: z.string(), // or z.string().url() if you want URL validation
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  created_at: z.number(), // or z.date().transform(d => d.getTime()) if you parse a Date
})

export type OAuthCredentials = z.infer<typeof OAuthCredentials>
