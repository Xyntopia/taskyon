import { llmSettings, partialTaskDraft, TyToolchainConfig } from '@taskyon/taskyon/api'
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
    .default('auto')
    .meta({ description: 'Explicitly set the taskyon dark mode' }),
  appConfigurationUrl: z.string().default('/taskyon_settings.json').meta({
    description: 'URL from which to load the initial app configuration',
  }),
  gdriveConfigurationFile: z.string().default('taskyon_settings.json').meta({
    description: 'gDrive fileid of the configuration',
  }),
  enableGdriveSync: z.boolean().default(false).optional(),
  expertMode: z.boolean().default(false).meta({
    title: 'Expert Mode',
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
            'Use url and label which point to a  markdown file which you want to use as a chat template!',
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
      title: 'Use Enter to Send',
      description: `Controls the behavior of the Enter key for sending messages.
  "Auto" enables sending messages with Enter on desktop devices while disabling it on mobile devices.
  Other options allow always enabling, always disabling, or requiring Shift+Enter to insert a new line.`,
    }),
  webSearchButton: z.boolean().optional().default(true).meta({
    description: 'Enable web search button in message editor.',
    title: 'Web Search Button',
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
  version: z.literal(26).meta({
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
