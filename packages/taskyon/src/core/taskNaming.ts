import { textRankTerms } from '../utils/nlp'

export type TaskNameMode = 'first-words' | 'textrank'

export type TaskNameOptions = {
  mode: TaskNameMode
  maxWords?: number
  maxChars?: number
}

const DEFAULT_MAX_WORDS = 4
const DEFAULT_MAX_CHARS = 50

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim()

const stripMarkdownSyntax = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|[\](){}]/g, ' ')

const trimTrailingPunctuation = (text: string) => text.replace(/[.,;:!?'"`]+$/, '')

const truncateToChars = (text: string, maxChars: number) => {
  if (text.length <= maxChars) return text
  const clipped = text.slice(0, maxChars).trimEnd()
  const lastSpace = clipped.lastIndexOf(' ')
  return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim()
}

const truncateToWords = (text: string, maxWords: number) =>
  text.split(' ').slice(0, maxWords).join(' ')

const cleanName = (text: string, maxWords: number, maxChars: number) =>
  truncateToChars(truncateToWords(normalizeWhitespace(text), maxWords), maxChars) || null

export function firstWordsTaskName(
  text: string,
  options: Pick<TaskNameOptions, 'maxWords' | 'maxChars'> = {},
): string | null {
  const maxWords = Math.max(1, options.maxWords ?? DEFAULT_MAX_WORDS)
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const normalized = normalizeWhitespace(stripMarkdownSyntax(text))
  if (!normalized) return null

  const words = normalized
    .split(' ')
    .map(trimTrailingPunctuation)
    .filter((word) => word.length > 0)

  return cleanName(words.slice(0, maxWords).join(' '), maxWords, maxChars)
}

export function textRankTaskName(
  text: string,
  options: Pick<TaskNameOptions, 'maxWords' | 'maxChars'> = {},
): string | null {
  const maxWords = Math.max(1, options.maxWords ?? DEFAULT_MAX_WORDS)
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const cleanedText = normalizeWhitespace(stripMarkdownSyntax(text))
  if (!cleanedText) return null

  const rankedTerms = textRankTerms(cleanedText, { maxTerms: maxWords })
  const name = cleanName(
    rankedTerms
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map((term) => term.display)
      .join(' '),
    maxWords,
    maxChars,
  )
  return name ?? firstWordsTaskName(cleanedText, { maxWords, maxChars })
}

export function generateTaskName(input: {
  text: string
  options: TaskNameOptions
}): Promise<string | null> {
  if (input.options.mode === 'textrank') {
    return Promise.resolve(textRankTaskName(input.text, input.options))
  }
  return Promise.resolve(firstWordsTaskName(input.text, input.options))
}
