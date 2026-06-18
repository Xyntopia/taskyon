import type { SystemModelMessage } from 'ai'

export type PromptInjection = string

export const systemMessage = (content: string): SystemModelMessage => ({ role: 'system', content })

export const toPromptMessages = (
  prompts: string[],
  promptInjections: PromptInjection[],
): {
  prependMessages: SystemModelMessage[]
  appendMessages: SystemModelMessage[]
} => {
  const prependMessages = promptInjections.map(systemMessage)
  const appendMessages = prompts.map(systemMessage)
  return { prependMessages, appendMessages }
}
