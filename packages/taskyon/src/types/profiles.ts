import z from 'zod'
import { deepCopy, deepMerge } from '../utils/objHelpers'
import {
  chatCompletionProviderSettings,
  type ChatCompletionProviderSettings,
} from './chatCompletion'
import { FunctionArguments } from './tools'

export const llmSettings = z.object({
  userId: z.string().nullish().optional().meta({
    description:
      'a (public) cryptographic user id which is used to identify the user in different chats',
  }),
  secretPublicKey: z.string().nullish().optional().meta({
    description: 'A (public) cryptographic key which is used to encrypt secrets',
  }),
  entryFunction: z.string().meta({
    description: `The function which is used as an entry point for taskyon.
When a user starts a conversation, this is always the first function that is called.
`,
  }),
  taskWorker: z
    .object({
      maxConcurrency: z
        .number()
        .int()
        .min(1)
        .default(4)
        .meta({ description: 'Maximum number of Taskyon worker tasks to process in parallel.' }),
    })
    .default({ maxConcurrency: 4 })
    .optional()
    .meta({ description: 'Runtime settings for the Taskyon task worker.' }),
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

export const ToolchainProfiles = z.object({
  base: TyToolchainConfig,
  profiles: z.record(z.string(), TyToolchainConfig).default({}),
})

export type ToolchainProfiles = z.infer<typeof ToolchainProfiles>

export const resolveToolchainConfig = (
  toolchainProfiles: ToolchainProfiles,
  selectedProfile?: string,
): TyToolchainConfig => {
  if (!selectedProfile) return deepCopy(toolchainProfiles.base)

  const profile = toolchainProfiles.profiles[selectedProfile]
  if (!profile) throw new Error(`Unknown toolchain profile: ${selectedProfile}`)

  return deepMerge(deepCopy(toolchainProfiles.base), deepCopy(profile), 'overwrite')
}

export const getToolchainProviderProfiles = (
  toolchainProfiles: ToolchainProfiles,
): Record<string, ChatCompletionProviderSettings> =>
  Object.entries(toolchainProfiles.profiles).reduce<Record<string, ChatCompletionProviderSettings>>(
    (providers, [profileName, profile]) => {
      const parsed = chatCompletionProviderSettings.safeParse(profile.chatCompletion)
      return parsed.success ? { ...providers, [profileName]: parsed.data } : providers
    },
    {},
  )

export const resolveToolchainProvider = (
  toolchainProfiles: ToolchainProfiles,
  selectedProfile: string | undefined,
) =>
  chatCompletionProviderSettings.parse(
    resolveToolchainConfig(toolchainProfiles, selectedProfile).chatCompletion,
  )

const hasOwnPath = (value: Record<string, unknown>, path: readonly string[]) => {
  let current: unknown = value
  for (const key of path) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.hasOwn(current, key)
    ) {
      return false
    }
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

const setObjectPath = (
  object: Record<string, unknown>,
  [key, ...remainingPath]: readonly string[],
  value: unknown,
): Record<string, unknown> => {
  if (!key) throw new Error('Cannot update an empty toolchain config path')
  if (!remainingPath.length) return { ...object, [key]: value }

  const current = object[key]
  const child =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? Object.fromEntries(Object.entries(current))
      : {}
  return {
    ...object,
    [key]: setObjectPath(child, remainingPath, value),
  }
}

export const updateToolchainConfigValue = (
  toolchainProfiles: ToolchainProfiles,
  selectedProfile: string | undefined,
  path: readonly string[],
  value: unknown,
): ToolchainProfiles => {
  if (selectedProfile) {
    const profile = toolchainProfiles.profiles[selectedProfile]
    if (!profile) throw new Error(`Unknown toolchain profile: ${selectedProfile}`)

    if (hasOwnPath(profile, path)) {
      return {
        ...toolchainProfiles,
        profiles: {
          ...toolchainProfiles.profiles,
          [selectedProfile]: TyToolchainConfig.parse(setObjectPath(profile, path, value)),
        },
      }
    }
  }

  return {
    ...toolchainProfiles,
    base: TyToolchainConfig.parse(setObjectPath(toolchainProfiles.base, path, value)),
  }
}
