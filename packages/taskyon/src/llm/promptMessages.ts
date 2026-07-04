import type { SystemModelMessage } from 'ai'

export type PromptInjection = string

export const systemMessage = (content: string): SystemModelMessage => ({ role: 'system', content })

export const toPromptMessages = (
  appendSystemPrompts: string[],
  prependSystemPrompts: PromptInjection[],
): {
  prependMessages: SystemModelMessage[]
  appendMessages: SystemModelMessage[]
} => {
  const prependMessages = prependSystemPrompts.map(systemMessage)
  const appendMessages = appendSystemPrompts.map(systemMessage)
  return { prependMessages, appendMessages }
}
