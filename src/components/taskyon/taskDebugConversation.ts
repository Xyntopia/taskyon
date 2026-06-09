import { serializeObject } from '@taskyon/shared/modules/serializeObject'
import type { TaskNodeMeta } from '@taskyon/taskyon'

export type ConversationEntry = {
  role: string
  text: string
}

type RawOutputChoice = {
  messageContent: unknown
  reasoning?: string
}

export type RawConversationDebug = {
  conversationMessages: ConversationEntry[]
  reasoningText: string
  completionText: string
}

const stringifyDebugValue = (value: unknown) =>
  serializeObject(value, {
    maxDepth: 3,
    maxArrayLength: 12,
    maxObjectKeys: 20,
    maxStringLength: 1200,
    format: 'yaml',
  })

const renderMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    return content.map(renderMessageContent).filter(Boolean).join('\n\n')
  }
  if (typeof content === 'object') {
    const maybeText = 'text' in content ? content.text : undefined
    if (typeof maybeText === 'string') return maybeText
  }
  return stringifyDebugValue(content)
}

const parseConversationMessages = (value: unknown): ConversationEntry[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('role' in entry)) return []
    const role = typeof entry.role === 'string' ? entry.role : 'unknown'
    const text = renderMessageContent('content' in entry ? entry.content : undefined).trim()
    return [{ role, text: text || '<empty message>' }]
  })
}

const parseRawOutputChoice = (value: unknown): RawOutputChoice | undefined => {
  if (!value || typeof value !== 'object' || !('choice' in value)) return undefined
  const choice = value.choice
  if (!choice || typeof choice !== 'object' || !('message' in choice)) return undefined
  const message = choice.message
  if (!message || typeof message !== 'object' || !('content' in message)) return undefined
  const reasoning =
    'reasoning' in choice && typeof choice.reasoning === 'string' ? choice.reasoning : undefined
  return {
    messageContent: message.content,
    ...(reasoning ? { reasoning } : {}),
  }
}

export const getRawConversationDebug = (
  taskMeta: TaskNodeMeta | undefined,
): RawConversationDebug => {
  const rawOutputChoice = parseRawOutputChoice(taskMeta?.rawOutput)
  return {
    conversationMessages: parseConversationMessages(taskMeta?.taskPrompt),
    reasoningText: rawOutputChoice?.reasoning?.trim() || taskMeta?.reasoning?.trim() || '',
    completionText: renderMessageContent(rawOutputChoice?.messageContent).trim(),
  }
}

export const hasRawConversationDebug = (debug: RawConversationDebug) =>
  debug.conversationMessages.length > 0 ||
  debug.reasoningText.length > 0 ||
  debug.completionText.length > 0

export const formatRawConversationDebug = (debug: RawConversationDebug) => {
  const sections = [
    ...debug.conversationMessages.map(
      (message) => `${message.role}\n${'-'.repeat(32)}\n${message.text}`,
    ),
    debug.reasoningText ? `assistant reasoning\n${'-'.repeat(32)}\n${debug.reasoningText}` : '',
    debug.completionText ? `assistant completion\n${'-'.repeat(32)}\n${debug.completionText}` : '',
  ].filter(Boolean)

  return sections.join('\n\n' + '='.repeat(48) + '\n\n')
}
