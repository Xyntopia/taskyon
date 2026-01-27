import z from 'zod'
import { apiConfig } from './chatCompletion'
import { partialTaskDraft } from './node'
import { FunctionArguments } from './tools'

// TODO: rename llmSettings to "tyOptions"
export const llmSettings = z.object({
  userId: z.string().nullish().optional().meta({
    description:
      'a (public) cryptographic user id which is used to identify the user in different chats',
  }),
  secretPublicKey: z.string().nullish().optional().meta({
    description: 'A (public) cryptographic key which is used to encrypt secrets',
  }),
  // TODO: this needs to go into appSettings!
  selectedTaskId: z.string().optional().meta({
    description:
      'The currently selected conversation defined by the ID of its last node. The task chain is defined through each tasknodes parent IDs',
  }),
  // TODO:  simply add apiconfig here..  if we want a different one, we would
  // simply load an entirely different settings profile
  // TODO: also:  move this to chatCompletion..  we are using chatCompletion for this after all!
  // we could also define a second tool for chatCompletion to get a list of models. which
  // we can then also use in our frontend
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
    title: 'Use Tools',
  }),
})
export type llmSettings = z.infer<typeof llmSettings>

/* ───────────────────────────────
   Tool-chain level configuration
   ─────────────────────────────── */
export const TyToolchainConfig = z
  .record(
    z.string(),
    FunctionArguments.describe(
      'Settings for a single tool. The tool ID is the ID of the tasknode where the tool is defined.',
    ),
  )
  .default({})
  .describe(`All tool parameters can be turned into settings as well. This makes taskyons
configuration very adaptable to new tools.
Taskyon lets you configure each tool with optional default values.
Taskyon provides the option of letting profiles partially be overriden by each other.`)

export type TyToolchainConfig = z.infer<typeof TyToolchainConfig>
