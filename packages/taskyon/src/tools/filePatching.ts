export type SearchReplacePatch = {
  search?: string
  searchStart?: string
  searchEnd?: string
  contextLines?: number
  replace: string
}

export type RegexReplacement = {
  pattern: string
  replace: string
  flags?: string
}

export type FileUpdate = {
  filePath: string
  patches?: SearchReplacePatch[]
  regexReplacements?: RegexReplacement[]
  newContent?: string
}

export type LinePatchOperation = {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number
  lineEnd?: number
  text?: string
}

type ApplyLinePatchesOptions = {
  validate?: boolean
}

type MatchRange = {
  start: number
  end: number
}

type MatchStrategy = {
  name: string
  find: (text: string, search: string) => MatchRange[]
}

type FileUpdateMode = 'newContent' | 'patches' | 'regexReplacements'

const MIN_CONTEXT_LINES = 3
const CONTEXT_LINE_CHAR_LIMIT = 50
const SUPPORTED_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])

const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, '\n')

const stripTrailingWhitespace = (value: string) => value.replace(/[ \t]+$/g, '')

const stripOuterWhitespace = (value: string) => value.trim()

const normalizeUnicodePunctuation = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')

const splitLines = (value: string) => normalizeLineEndings(value).split('\n')

const countLines = (value: string) => splitLines(value).length

const normalizePatch = (patch: SearchReplacePatch): SearchReplacePatch => {
  const next: SearchReplacePatch = { ...patch }
  const search = typeof next.search === 'string' ? next.search.trim() : ''
  const hasSearch = search.length > 0

  if (hasSearch) {
    next.search = search
    delete next.searchStart
    delete next.searchEnd
    delete next.contextLines
    return next
  }

  if (typeof next.search === 'string' && next.search.trim().length === 0) {
    delete next.search
  }

  if (typeof next.searchStart === 'string' && next.searchStart.trim().length === 0) {
    delete next.searchStart
  }

  if (typeof next.searchEnd === 'string' && next.searchEnd.trim().length === 0) {
    delete next.searchEnd
  }

  if (next.contextLines !== undefined) {
    if (!Number.isFinite(next.contextLines)) {
      delete next.contextLines
    } else {
      const normalized = Math.trunc(next.contextLines)
      next.contextLines = normalized < MIN_CONTEXT_LINES ? MIN_CONTEXT_LINES : normalized
    }
  }

  return next
}

const validateLinePatches = (lines: readonly string[], patches: readonly LinePatchOperation[]) => {
  let firstLine = Infinity

  for (const patch of patches) {
    const lineStart = patch.lineStart
    if (!Number.isInteger(lineStart) || lineStart < 1) {
      throw new Error(`Invalid patch lineStart: ${String(lineStart)}`)
    }

    const endLine = patch.type === 'insert' ? lineStart : (patch.lineEnd ?? lineStart)
    if (!Number.isInteger(endLine) || endLine < lineStart) {
      throw new Error(`Invalid patch lineEnd for range ${lineStart} to ${String(patch.lineEnd)}`)
    }

    if (endLine >= firstLine) {
      throw new Error('Overlapping or unsorted patches detected')
    }

    if (patch.type === 'insert') {
      if (lineStart > lines.length + 1) {
        throw new Error(`Insert lineStart out of range: ${lineStart}`)
      }
      if (patch.text === undefined || patch.text === null) {
        throw new Error('Insert patch requires text')
      }
    } else {
      if (lineStart > lines.length || endLine > lines.length) {
        throw new Error(`Patch range out of range: ${lineStart} to ${endLine} for ${lines.length} lines`)
      }
      if (patch.type === 'replace' && (patch.text === undefined || patch.text === null)) {
        throw new Error('Replace patch requires text')
      }
    }

    firstLine = lineStart
  }
}

export const applyLinePatches = (
  text: string,
  patches: readonly LinePatchOperation[],
  options: ApplyLinePatchesOptions = {},
): string => {
  const lines = normalizeLineEndings(text ?? '').split('\n')
  const sortedPatches = [...patches].sort((a, b) => b.lineStart - a.lineStart)

  if (options.validate) {
    validateLinePatches(lines, sortedPatches)
  }

  for (const patch of sortedPatches) {
    const startIdx = patch.lineStart - 1
    if (startIdx < 0) continue

    if (patch.type === 'insert') {
      const newLines = normalizeLineEndings(patch.text ?? '').split('\n')
      lines.splice(startIdx, 0, ...newLines)
      continue
    }

    const endLine = patch.lineEnd ?? patch.lineStart
    const deleteCount = endLine - patch.lineStart + 1

    if (patch.type === 'delete') {
      lines.splice(startIdx, deleteCount)
      continue
    }

    const newLines = normalizeLineEndings(patch.text ?? '').split('\n')
    lines.splice(startIdx, deleteCount, ...newLines)
  }

  return lines.join('\n')
}

const buildLineStarts = (text: string) => {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1)
    }
  }
  return starts
}

const findAllExactMatches = (text: string, search: string): MatchRange[] => {
  const matches: MatchRange[] = []
  let offset = 0

  while (offset <= text.length) {
    const index = text.indexOf(search, offset)
    if (index === -1) break
    matches.push({ start: index, end: index + search.length })
    offset = index + 1
  }

  return matches
}

const createLineMatchFinder =
  (
    normalizeLine: (value: string) => string,
    linesMatch: (candidate: string, search: string) => boolean = (candidate, search) =>
      candidate === search,
  ) =>
  (text: string, search: string): MatchRange[] => {
    const textLines = splitLines(text)
    const searchLines = splitLines(search)

    if (!searchLines.length || searchLines.length > textLines.length) {
      return []
    }

    const lineStarts = buildLineStarts(text)
    const matches: MatchRange[] = []
    const normalizedSearchLines = searchLines.map(normalizeLine)

    for (let lineIndex = 0; lineIndex <= textLines.length - searchLines.length; lineIndex += 1) {
      let matchesWindow = true

      for (let offset = 0; offset < searchLines.length; offset += 1) {
        const normalizedCandidate = normalizeLine(textLines[lineIndex + offset] || '')
        const normalizedSearch = normalizedSearchLines[offset] || ''
        if (!linesMatch(normalizedCandidate, normalizedSearch)) {
          matchesWindow = false
          break
        }
      }

      if (!matchesWindow) continue

      const start = lineStarts[lineIndex] ?? 0
      const nextLineIndex = lineIndex + searchLines.length
      const end =
        nextLineIndex < lineStarts.length ? (lineStarts[nextLineIndex] ?? text.length) - 1 : text.length

      matches.push({ start, end })
    }

    return matches
  }

const matchesLineByPrefix = (candidate: string, search: string) => {
  if (!search.length) return !candidate.length
  const prefix = search.slice(0, Math.min(CONTEXT_LINE_CHAR_LIMIT, search.length))
  return candidate.startsWith(prefix)
}

const matchStrategies: MatchStrategy[] = [
  {
    name: 'exact',
    find: findAllExactMatches,
  },
  {
    name: 'trim-trailing-whitespace',
    find: createLineMatchFinder(stripTrailingWhitespace),
  },
  {
    name: 'trim-edge-whitespace',
    find: createLineMatchFinder(stripOuterWhitespace),
  },
  {
    name: 'soft-normalized',
    find: createLineMatchFinder((value) => normalizeUnicodePunctuation(stripOuterWhitespace(value))),
  },
]

const contextMatchStrategies: MatchStrategy[] = [
  {
    name: 'trimmed-prefix',
    find: createLineMatchFinder(stripOuterWhitespace, matchesLineByPrefix),
  },
  {
    name: 'soft-normalized-prefix',
    find: createLineMatchFinder(
      (value) => normalizeUnicodePunctuation(stripOuterWhitespace(value)),
      matchesLineByPrefix,
    ),
  },
]

const summarizeSearchSnippet = (value: string) => {
  const firstNonEmptyLine = normalizeLineEndings(value)
    .split('\n')
    .find((line) => line.trim().length > 0)
  const snippet = (firstNonEmptyLine || '').trim()
  if (!snippet) return '(empty snippet)'
  return snippet.length > 120 ? `${snippet.slice(0, 117)}...` : snippet
}

const getUniqueMatch = (text: string, search: string, patchIndex: number): MatchRange => {
  for (const strategy of matchStrategies) {
    const matches = strategy.find(text, search)
    if (matches.length === 1) {
      return matches[0]
    }
    if (matches.length > 1) {
      throw new Error(
        [
          `Patch ${patchIndex + 1} is ambiguous.`,
          `The search block matched ${matches.length} regions using ${strategy.name} matching.`,
          'There were multiple matches for this patch, so we need a more precise search block.',
          `Search preview: ${summarizeSearchSnippet(search)}`,
        ].join(' '),
      )
    }
  }

  throw new Error(
    [
      `Patch ${patchIndex + 1} could not be located in the current file.`,
      'Copy the search block exactly from the file, or include a bit more nearby context.',
      `Search preview: ${summarizeSearchSnippet(search)}`,
    ].join(' '),
  )
}

const getUniqueContextRange = (
  text: string,
  searchStart: string,
  searchEnd: string,
  patchIndex: number,
): MatchRange => {
  for (const strategy of contextMatchStrategies) {
    const startMatches = strategy.find(text, searchStart)
    const endMatches = strategy.find(text, searchEnd)
    const validRanges: MatchRange[] = []

    for (const startMatch of startMatches) {
      for (const endMatch of endMatches) {
        if (endMatch.start < startMatch.start) continue
        validRanges.push({ start: startMatch.start, end: endMatch.end })
      }
    }

    if (validRanges.length === 1) {
      return validRanges[0]
    }

    if (validRanges.length > 1) {
      throw new Error(
        [
          `Patch ${patchIndex + 1} is ambiguous.`,
          `The start/end context matched ${validRanges.length} regions using ${strategy.name} matching.`,
          'There were multiple matches for this patch, so we need more precise context.',
          `Start preview: ${summarizeSearchSnippet(searchStart)}`,
          `End preview: ${summarizeSearchSnippet(searchEnd)}`,
        ].join(' '),
      )
    }
  }

  throw new Error(
    [
      `Patch ${patchIndex + 1} could not be located in the current file.`,
      `Provide at least ${MIN_CONTEXT_LINES} lines for both \`searchStart\` and \`searchEnd\`, copied from the latest file contents.`,
      `Start preview: ${summarizeSearchSnippet(searchStart)}`,
      `End preview: ${summarizeSearchSnippet(searchEnd)}`,
    ].join(' '),
  )
}

const assertValidPatch = (patch: SearchReplacePatch, patchIndex: number) => {
  const hasSearch = typeof patch.search === 'string' && patch.search.length > 0
  const hasSearchStart = typeof patch.searchStart === 'string' && patch.searchStart.length > 0
  const hasSearchEnd = typeof patch.searchEnd === 'string' && patch.searchEnd.length > 0
  const hasRangeSearch = hasSearchStart || hasSearchEnd
  const rawContextLines =
    patch.contextLines === undefined
      ? undefined
      : Number.isFinite(patch.contextLines)
        ? Math.trunc(patch.contextLines)
        : NaN
  const contextLines = Math.max(
    MIN_CONTEXT_LINES,
    Number.isFinite(rawContextLines) ? rawContextLines : MIN_CONTEXT_LINES,
  )

  if (!hasSearch && !hasRangeSearch) {
    throw new Error(
      `Patch ${patchIndex + 1} is missing search content. Provide either \`search\` or both \`searchStart\` and \`searchEnd\`.`,
    )
  }

  if (hasSearch && hasRangeSearch) {
    throw new Error(
      `Patch ${patchIndex + 1} mixes exact-search and range-context modes. Use either \`search\` or \`searchStart\` + \`searchEnd\`.`,
    )
  }

  if (hasRangeSearch && (!hasSearchStart || !hasSearchEnd)) {
    throw new Error(
      `Patch ${patchIndex + 1} must provide both \`searchStart\` and \`searchEnd\` when using context-based patching.`,
    )
  }

  if (hasSearchStart && countLines(patch.searchStart || '') < contextLines) {
    throw new Error(
      `Patch ${patchIndex + 1} needs at least ${contextLines} lines in \`searchStart\`. The minimum supported value is ${MIN_CONTEXT_LINES}.`,
    )
  }

  if (hasSearchEnd && countLines(patch.searchEnd || '') < contextLines) {
    throw new Error(
      `Patch ${patchIndex + 1} needs at least ${contextLines} lines in \`searchEnd\`. The minimum supported value is ${MIN_CONTEXT_LINES}.`,
    )
  }

  if (rawContextLines !== undefined && !Number.isFinite(rawContextLines)) {
    throw new Error(
      `Patch ${patchIndex + 1} has an invalid \`contextLines\` value. Use ${MIN_CONTEXT_LINES} or more.`,
    )
  }

  if ((rawContextLines ?? MIN_CONTEXT_LINES) < MIN_CONTEXT_LINES) {
    throw new Error(
      `Patch ${patchIndex + 1} has an invalid \`contextLines\` value. Use ${MIN_CONTEXT_LINES} or more.`,
    )
  }

  if (typeof patch.replace !== 'string') {
    throw new Error(`Patch ${patchIndex + 1} is missing a string replace block.`)
  }
}

const assertValidRegexReplacement = (replacement: RegexReplacement, index: number) => {
  if (typeof replacement.pattern !== 'string' || !replacement.pattern.length) {
    throw new Error(`Regex replacement ${index + 1} is missing a non-empty pattern.`)
  }

  if (typeof replacement.replace !== 'string') {
    throw new Error(`Regex replacement ${index + 1} is missing a string replace block.`)
  }
}

const assertNoOverlaps = (matches: Array<MatchRange & { patchIndex: number }>) => {
  const sorted = [...matches].sort((a, b) => a.start - b.start)

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]

    if (current.start < previous.end) {
      throw new Error(
        `Patches ${previous.patchIndex + 1} and ${current.patchIndex + 1} overlap. Split them into separate non-overlapping search blocks.`,
      )
    }
  }
}

const compileRegexPattern = (pattern: string, flags: string | undefined, index: number): RegExp => {
  const rawFlags = (flags || 'g').trim()
  const uniqueFlags = new Set<string>()

  for (const flag of rawFlags) {
    if (!SUPPORTED_REGEX_FLAGS.has(flag)) {
      throw new Error(
        `Regex replacement ${index + 1} uses unsupported flag "${flag}". Use JavaScript-compatible regex flags only.`,
      )
    }
    uniqueFlags.add(flag)
  }

  try {
    return new RegExp(pattern, Array.from(uniqueFlags).join(''))
  } catch (error) {
    throw new Error(
      `Regex replacement ${index + 1} has an invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export const applyContextPatches = (text: string, patches: readonly SearchReplacePatch[]): string => {
  const normalizedText = normalizeLineEndings(text)
  const locatedPatches = patches.map((patch, patchIndex) => {
    assertValidPatch(patch, patchIndex)

    const range =
      typeof patch.search === 'string' && patch.search.length
        ? getUniqueMatch(normalizedText, normalizeLineEndings(patch.search), patchIndex)
        : getUniqueContextRange(
            normalizedText,
            normalizeLineEndings(patch.searchStart || ''),
            normalizeLineEndings(patch.searchEnd || ''),
            patchIndex,
          )

    return {
      ...range,
      patchIndex,
      replace: normalizeLineEndings(patch.replace),
    }
  })

  assertNoOverlaps(locatedPatches)

  let nextText = normalizedText
  for (const patch of [...locatedPatches].sort((a, b) => b.start - a.start)) {
    nextText = `${nextText.slice(0, patch.start)}${patch.replace}${nextText.slice(patch.end)}`
  }

  return nextText
}

export const applyRegexReplacements = (
  text: string,
  replacements: readonly RegexReplacement[],
): string => {
  let nextText = normalizeLineEndings(text)

  replacements.forEach((replacement, index) => {
    assertValidRegexReplacement(replacement, index)
    const pattern = compileRegexPattern(replacement.pattern, replacement.flags, index)
    const testPattern = new RegExp(pattern.source, pattern.flags)

    if (!testPattern.test(nextText)) {
      throw new Error(
        `Regex replacement ${index + 1} did not match anything. Pattern preview: ${summarizeSearchSnippet(replacement.pattern)}`,
      )
    }

    nextText = nextText.replace(pattern, replacement.replace)
  })

  return nextText
}

export const getFileUpdateMode = (update: FileUpdate): FileUpdateMode => {
  const modes: FileUpdateMode[] = []

  if (typeof update.newContent === 'string') {
    modes.push('newContent')
  }
  if (update.patches?.length) {
    modes.push('patches')
  }
  if (update.regexReplacements?.length) {
    modes.push('regexReplacements')
  }

  if (!modes.length) {
    throw new Error(`No edits were provided for "${update.filePath}"`)
  }

  if (modes.length > 1) {
    throw new Error(
      `Update for "${update.filePath}" mixes multiple edit modes. Use exactly one of \`newContent\`, \`patches\`, or \`regexReplacements\`.`,
    )
  }

  return modes[0]
}

export const applyFileUpdateToContent = (text: string, update: FileUpdate): string => {
  const mode = getFileUpdateMode(update)

  if (mode === 'newContent') {
    return normalizeLineEndings(update.newContent || '')
  }

  if (mode === 'patches') {
    return applyContextPatches(text, update.patches || [])
  }

  return applyRegexReplacements(text, update.regexReplacements || [])
}

export const normalizeFileUpdate = <T extends FileUpdate>(update: T): T => {
  if (!update) return update

  const next: FileUpdate = update.patches?.length
    ? { ...update, patches: update.patches.map(normalizePatch) }
    : update

  if ((next.patches?.length || next.regexReplacements?.length) && next.newContent === '') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { newContent: _ignoredNewContent, ...rest } = next
    return rest as T
  }

  return next as T
}
