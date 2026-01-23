import { matSmartToy, matVisibility, matVisibilityOff } from '@quasar/extras/material-icons'
import {
  mdiAlphabeticalVariant,
  mdiAutoFix,
  mdiFunctionVariant,
  mdiSearchWeb,
  mdiTools,
} from '@quasar/extras/mdi-v6'
import z from 'zod'
import { apiConfig } from './chatCompletion'
import { partialTaskDraft } from './node'

// TODO: rename llmSettings to "tyOptions"
// TODO: move most of this into "tool Profiles"
export const llmSettings = z.object({
  userId: z.string().nullish().optional().meta({
    description:
      'a (public) cryptographic user id which is used to identify the user in different chats',
  }),
  allowWebSearch: z.boolean().optional().default(true).meta({
    description: 'Allow web search for chat Completion.',
    icon: mdiSearchWeb,
    label: 'Web Search',
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
  tryUsingVisionModels: z
    .boolean()
    .default(true)
    .meta({
      icon: matVisibility,
      offIcon: matVisibilityOff,
      label: 'Vision',
      description: `Toggle Vision ON/OFF. If a model supports vision, we
will send the model attached images and pdf files..`,
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
export const TyToolchainConfig = z
  .record(
    z.string(),
    z
      .json()
      .describe(
        'Settings for a single tool. The tool ID is the ID of the tasknode where the tool is defined.',
      ),
  )
  .default({})
  .describe(`All tool parameters can be turned into settings as well. This makes taskyons
configuration very adaptable to new tools.
Taskyon lets you configure each tool with optional default values.
Taskyon provides the option of letting profiles partially be overriden by each other.`)

export type TyToolchainConfig = z.infer<typeof TyToolchainConfig>
