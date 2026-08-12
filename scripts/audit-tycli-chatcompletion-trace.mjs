#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const usage = () => {
  console.error('Usage: node scripts/audit-tycli-chatcompletion-trace.mjs <trace-dir> [--json]')
  process.exit(1)
}

const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const traceDir = args.find((arg) => !arg.startsWith('--'))

if (!traceDir) usage()

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const byteSize = (path) => statSync(path).size
const jsonChars = (value) => JSON.stringify(value ?? '').length
const sha = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
const unique = (values) => [...new Set(values)]
const sum = (values) => values.reduce((total, value) => total + value, 0)
const numberOrZero = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const traceFileNames = readdirSync(traceDir).sort()
const fileEntries = traceFileNames
  .filter((name) => /_(input|output)\.json$/.test(name))
  .map((name) => {
    const sequence = Number(name.match(/^(\d+)_/)?.[1] ?? 0)
    const side = name.endsWith('_input.json') ? 'input' : 'output'
    const path = join(traceDir, name)
    return { name, path, sequence, side, data: readJson(path), bytes: byteSize(path) }
  })

const inputEntries = fileEntries.filter((entry) => entry.side === 'input')
const outputEntries = fileEntries.filter((entry) => entry.side === 'output')
const outputsBySequence = new Map(outputEntries.map((entry) => [entry.sequence, entry]))
const recordEntries = traceFileNames
  .filter((name) => /_record\.json$/.test(name))
  .map((name) => {
    const path = join(traceDir, name)
    const data = readJson(path)
    return {
      name,
      path,
      sequence: numberOrZero(data?.sequence) || Number(name.match(/^(\d+)_/)?.[1] ?? 0),
      data,
      bytes: byteSize(path),
    }
  })
const useRecordFormat = recordEntries.length > 0

const extractRequest = (entry) => entry.data?.input?.request ?? {}
const extractMessages = (request) => (Array.isArray(request.messages) ? request.messages : [])
const extractInstructions = (request) =>
  typeof request.instructions === 'string'
    ? request.instructions
    : typeof request.providerOptions?.openai?.instructions === 'string'
      ? request.providerOptions.openai.instructions
      : ''
const extractRequestPromptCacheKey = (request) =>
  typeof request.prompt_cache_key === 'string'
    ? request.prompt_cache_key
    : typeof request.providerOptions?.openai?.promptCacheKey === 'string'
      ? request.providerOptions.openai.promptCacheKey
      : ''
const extractRequestItems = (request) =>
  Array.isArray(request.input) ? request.input : extractMessages(request)
const extractToolsHash = (request) => sha(JSON.stringify(request.tools ?? []))
const extractUsage = (entry) => entry?.data?.output?.usage ?? {}
const extractRawOutput = (entry) =>
  typeof entry?.data?.output?.rawOutput === 'string' ? entry.data.output.rawOutput : ''
const extractRawOutputChars = (entry) => {
  const rawOutput = entry?.data?.output?.rawOutput
  if (typeof rawOutput === 'string') return rawOutput.length
  if (typeof rawOutput?.chars === 'number' && Number.isFinite(rawOutput.chars)) {
    return rawOutput.chars
  }
  return 0
}
const extractPromptCacheKeys = (rawOutput) =>
  unique([...rawOutput.matchAll(/prompt_cache_key:\s*([^\n]+)/g)].map((match) => match[1].trim()))
const extractPromptCacheRetention = (rawOutput) =>
  unique(
    [...rawOutput.matchAll(/prompt_cache_retention:\s*([^\n]+)/g)].map((match) => match[1].trim()),
  )
const commonPrefixLength = (previous, current) => {
  let index = 0
  while (
    index < previous.length &&
    index < current.length &&
    JSON.stringify(previous[index]) === JSON.stringify(current[index])
  ) {
    index += 1
  }
  return index
}
const stableConversationMessages = (messages, provider) => {
  if (provider !== 'chatgpt-codex') return messages
  let end = messages.length
  while (end > 0 && messages[end - 1]?.role === 'developer') end -= 1
  return messages.slice(0, end)
}

const legacyRequests = inputEntries.map((inputEntry) => {
  const outputEntry = outputsBySequence.get(inputEntry.sequence)
  const request = extractRequest(inputEntry)
  const messages = extractRequestItems(request)
  const conversationMessages = messages
  const instructions = extractInstructions(request)
  const requestPromptCacheKey = extractRequestPromptCacheKey(request)
  const usage = extractUsage(outputEntry)
  const rawOutput = extractRawOutput(outputEntry)
  const rawOutputChars = extractRawOutputChars(outputEntry)
  const cacheReadTokens =
    numberOrZero(usage.inputTokenDetails?.cacheReadTokens) || numberOrZero(usage.cachedInputTokens)
  const noCacheTokens = numberOrZero(usage.inputTokenDetails?.noCacheTokens)
  const cacheWriteTokens = numberOrZero(usage.inputTokenDetails?.cacheWriteTokens)
  const usageAvailable = Object.keys(usage).length > 0

  return {
    sequence: inputEntry.sequence,
    inputFile: inputEntry.name,
    outputFile: outputEntry?.name,
    paired: Boolean(outputEntry),
    completed: Boolean(outputEntry),
    attemptCount: 1,
    provider: '',
    model: '',
    responseStatus: undefined,
    inputPayloadChars: jsonChars(inputEntry.data.input),
    outputPayloadChars: jsonChars(outputEntry?.data?.output),
    inputFileBytes: inputEntry.bytes,
    outputFileBytes: outputEntry?.bytes ?? 0,
    messageCount: messages.length,
    lastMessageRole: messages.at(-1)?.role ?? '',
    firstMessageHash: sha(JSON.stringify(conversationMessages[0] ?? null)),
    firstTwoMessagesHash:
      conversationMessages.length >= 2
        ? sha(JSON.stringify(conversationMessages.slice(0, 2)))
        : null,
    instructionsChars: instructions.length,
    instructionsHash: sha(instructions),
    requestPromptCacheKey,
    hasParentWorkspaceInstructions: instructions.includes('# ../../../../AGENTS.md'),
    rawOutputChars,
    rawOutputShare:
      outputEntry && outputEntry.data?.output
        ? rawOutputChars / Math.max(1, jsonChars(outputEntry.data.output))
        : 0,
    promptCacheKeys: extractPromptCacheKeys(rawOutput),
    promptCacheRetention: extractPromptCacheRetention(rawOutput),
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
    totalTokens: numberOrZero(usage.totalTokens),
    cacheReadTokens,
    noCacheTokens,
    cacheWriteTokens,
    usageAvailable,
    toolsHash: extractToolsHash(request),
    _messages: conversationMessages,
  }
})

const recordRequests = recordEntries.map((entry) => {
  const providerRequest = entry.data?.providerRequest ?? {}
  const provider = typeof providerRequest.provider === 'string' ? providerRequest.provider : ''
  const attempts = Array.isArray(providerRequest.attempts) ? providerRequest.attempts : []
  const attempt = attempts.at(-1) ?? {}
  const request = attempt.requestBody ?? {}
  const messages = extractRequestItems(request)
  const conversationMessages = stableConversationMessages(messages, provider)
  const instructions = extractInstructions(request)
  const responseMetadata = attempt.response ?? attempt.error
  const usage = providerRequest.usage
  const usageAvailable = usage !== undefined && usage !== null

  return {
    sequence: entry.sequence,
    inputFile: entry.name,
    outputFile: undefined,
    paired: Boolean(responseMetadata),
    completed: Boolean(responseMetadata),
    attemptCount: attempts.length,
    provider,
    model: typeof providerRequest.model === 'string' ? providerRequest.model : '',
    responseStatus: numberOrZero(attempt.response?.status) || undefined,
    inputPayloadChars: jsonChars(request),
    outputPayloadChars: jsonChars(responseMetadata),
    inputFileBytes: entry.bytes,
    outputFileBytes: 0,
    messageCount: messages.length,
    lastMessageRole: messages.at(-1)?.role ?? messages.at(-1)?.type ?? '',
    firstMessageHash: sha(JSON.stringify(conversationMessages[0] ?? null)),
    firstTwoMessagesHash:
      conversationMessages.length >= 2
        ? sha(JSON.stringify(conversationMessages.slice(0, 2)))
        : null,
    instructionsChars: instructions.length,
    instructionsHash: sha(instructions),
    requestPromptCacheKey: extractRequestPromptCacheKey(request),
    hasParentWorkspaceInstructions: instructions.includes('# ../../../../AGENTS.md'),
    rawOutputChars: 0,
    rawOutputShare: 0,
    promptCacheKeys: [],
    promptCacheRetention: [],
    inputTokens: numberOrNull(usage?.inputTokens?.total),
    outputTokens: numberOrNull(usage?.outputTokens?.total),
    totalTokens: numberOrNull(usage?.totalTokens),
    cacheReadTokens: numberOrNull(usage?.inputTokens?.cacheRead),
    cacheWriteTokens: numberOrNull(usage?.inputTokens?.cacheWrite),
    noCacheTokens: numberOrNull(usage?.inputTokens?.noCache),
    usageAvailable,
    toolsHash: extractToolsHash(request),
    recordedAt: typeof providerRequest.recordedAt === 'string' ? providerRequest.recordedAt : null,
    _messages: conversationMessages,
  }
})

const requests = useRecordFormat ? recordRequests : legacyRequests

const requestFamilyKey = (request) =>
  [request.provider, request.model, request.requestPromptCacheKey, request.toolsHash].join('|')

const previousMessagesByFamily = new Map()
const requestsWithPrefixStats = requests.map((request) => {
  const familyKey = requestFamilyKey(request)
  const previousMessages = previousMessagesByFamily.get(familyKey) ?? []
  const currentMessages = request._messages
  const commonMessagesWithPrevious =
    previousMessages.length > 0 ? commonPrefixLength(previousMessages, currentMessages) : 0
  previousMessagesByFamily.set(familyKey, currentMessages)

  const { _messages, ...publicRequest } = request
  return {
    ...publicRequest,
    requestFamily: sha(familyKey),
    commonMessagesWithPrevious,
    commonMessagePrefixChars:
      commonMessagesWithPrevious > 0
        ? JSON.stringify(currentMessages.slice(0, commonMessagesWithPrevious)).length
        : 0,
  }
})

const totals = {
  chatCompletions: requestsWithPrefixStats.length,
  completedChatCompletions: requestsWithPrefixStats.filter((request) => request.completed).length,
  pairedChatCompletions: requestsWithPrefixStats.filter((request) => request.paired).length,
  inputPayloadChars: sum(requestsWithPrefixStats.map((request) => request.inputPayloadChars)),
  outputPayloadChars: sum(requestsWithPrefixStats.map((request) => request.outputPayloadChars)),
  inputFileBytes: sum(requestsWithPrefixStats.map((request) => request.inputFileBytes)),
  outputFileBytes: sum(requestsWithPrefixStats.map((request) => request.outputFileBytes)),
  usageAvailableChatCompletions: requestsWithPrefixStats.filter((request) => request.usageAvailable)
    .length,
  usageUnavailableChatCompletions: requestsWithPrefixStats.filter(
    (request) => !request.usageAvailable,
  ).length,
  inputTokens: sum(requestsWithPrefixStats.map((request) => numberOrZero(request.inputTokens))),
  outputTokens: sum(requestsWithPrefixStats.map((request) => numberOrZero(request.outputTokens))),
  totalTokens: sum(requestsWithPrefixStats.map((request) => numberOrZero(request.totalTokens))),
  cacheReadTokens: sum(
    requestsWithPrefixStats.map((request) => numberOrZero(request.cacheReadTokens)),
  ),
  cacheWriteTokens: sum(
    requestsWithPrefixStats.map((request) => numberOrZero(request.cacheWriteTokens)),
  ),
  noCacheTokens: sum(requestsWithPrefixStats.map((request) => numberOrZero(request.noCacheTokens))),
  rawOutputChars: sum(requestsWithPrefixStats.map((request) => request.rawOutputChars)),
}

const firstMessageHashes = unique(
  requestsWithPrefixStats.map((request) => request.firstMessageHash),
)
const firstTwoMessagesHashes = unique(
  requestsWithPrefixStats.map((request) => request.firstTwoMessagesHash).filter(Boolean),
)
const instructionHashes = unique(requestsWithPrefixStats.map((request) => request.instructionsHash))
const promptCacheKeys = unique(
  requestsWithPrefixStats.flatMap((request) => request.promptCacheKeys),
)
const requestPromptCacheKeys = unique(
  requestsWithPrefixStats.map((request) => request.requestPromptCacheKey).filter(Boolean),
)
const promptCacheRetention = unique(
  requestsWithPrefixStats.flatMap((request) => request.promptCacheRetention),
)
const messageCounts = requestsWithPrefixStats.map((request) => request.messageCount)
const lastMessageRoles = requestsWithPrefixStats.map((request) => request.lastMessageRole || 'none')
const instructionChars = requestsWithPrefixStats.map((request) => request.instructionsChars)
const commonMessagePrefixChars = requestsWithPrefixStats.map(
  (request) => request.commonMessagePrefixChars,
)
const requestsByFamily = Map.groupBy(requestsWithPrefixStats, (request) => request.requestFamily)
const requestFamilies = [...requestsByFamily.entries()].map(([id, familyRequests]) => ({
  id,
  requests: familyRequests.map((request) => request.sequence),
  requestPromptCacheKey: familyRequests[0]?.requestPromptCacheKey ?? '',
  instructionsHash: familyRequests[0]?.instructionsHash ?? '',
  toolsHash: familyRequests[0]?.toolsHash ?? '',
  firstMessageStable: unique(familyRequests.map((request) => request.firstMessageHash)).length <= 1,
  firstTwoMessagesStable:
    unique(familyRequests.map((request) => request.firstTwoMessagesHash).filter(Boolean)).length <=
    1,
  providerInstructionsStable:
    unique(familyRequests.map((request) => request.instructionsHash)).length <= 1,
}))
const cacheKeyToolShapes = Map.groupBy(
  requestsWithPrefixStats.filter((request) => request.requestPromptCacheKey),
  (request) => request.requestPromptCacheKey,
)
const cacheKeysWithMultipleToolShapes = [...cacheKeyToolShapes.entries()]
  .filter(
    ([, keyedRequests]) => unique(keyedRequests.map((request) => request.toolsHash)).length > 1,
  )
  .map(([key]) => key)

const warnings = [
  requestsWithPrefixStats.length === 0 ? 'No supported trace files were found.' : undefined,
  requestsWithPrefixStats.some((request) => !request.completed)
    ? 'Some traced requests have no recorded response or transport error.'
    : undefined,
  requestFamilies.some((family) => !family.firstMessageStable)
    ? 'The first message is not stable within at least one request family.'
    : undefined,
  requestFamilies.some((family) => !family.firstTwoMessagesStable)
    ? 'The first two messages are not stable within at least one request family.'
    : undefined,
  requestFamilies.some((family) => !family.providerInstructionsStable)
    ? 'Provider instructions are not stable within at least one request family.'
    : undefined,
  totals.usageUnavailableChatCompletions > 0
    ? 'Provider token usage is unavailable for some requests; missing usage is not counted as zero.'
    : undefined,
  totals.cacheReadTokens === 0 && totals.inputTokens > 0 && totals.usageAvailableChatCompletions > 0
    ? 'Provider usage reports zero cached input tokens.'
    : undefined,
  promptCacheKeys.length > Math.max(1, requests.length / 2)
    ? 'Raw response prompt_cache_key values are distinct; use request promptCacheKey and cacheReadTokens as the primary cache signals.'
    : undefined,
  requestsWithPrefixStats.some((request) => request.hasParentWorkspaceInstructions)
    ? 'Parent workspace AGENTS.md content appears in the provider instructions.'
    : undefined,
  requestsWithPrefixStats.some((request) => request.rawOutputShare > 0.5)
    ? 'Raw provider output dominates at least one output trace payload.'
    : undefined,
].filter(Boolean)

const report = {
  traceDir,
  traceFormat: useRecordFormat ? 'provider-request-record' : 'legacy-input-output',
  totals,
  stability: {
    firstMessageStable: requestFamilies.every((family) => family.firstMessageStable),
    firstTwoMessagesStable: requestFamilies.every((family) => family.firstTwoMessagesStable),
    providerInstructionsStable: requestFamilies.every(
      (family) => family.providerInstructionsStable,
    ),
    firstMessageHashes,
    firstTwoMessagesHashes,
    instructionHashes,
    requestPromptCacheKeys,
    promptCacheKeys,
    promptCacheRetention,
    messageCounts,
    lastMessageRoles,
    instructionChars,
    requestFamilies,
    cacheKeysWithMultipleToolShapes,
  },
  warnings,
  requests: requestsWithPrefixStats,
}

const formatNumber = (value) => value.toLocaleString('en-US')
const yesNo = (value) => (value ? 'yes' : 'no')

const renderMarkdown = () => {
  const lines = [
    '# tycli chatCompletion Trace Audit',
    '',
    `Trace directory: \`${traceDir}\``,
    '',
    '## Totals',
    '',
    `- chatCompletion calls: ${formatNumber(totals.chatCompletions)}`,
    `- completed calls: ${formatNumber(totals.completedChatCompletions)}`,
    `- input payload chars: ${formatNumber(totals.inputPayloadChars)}`,
    `- output payload chars: ${formatNumber(totals.outputPayloadChars)}`,
    `- input file bytes: ${formatNumber(totals.inputFileBytes)}`,
    `- output file bytes: ${formatNumber(totals.outputFileBytes)}`,
    `- provider input tokens: ${formatNumber(totals.inputTokens)}`,
    `- provider output tokens: ${formatNumber(totals.outputTokens)}`,
    `- provider total tokens: ${formatNumber(totals.totalTokens)}`,
    `- requests with provider usage: ${formatNumber(totals.usageAvailableChatCompletions)}`,
    `- requests without provider usage: ${formatNumber(totals.usageUnavailableChatCompletions)}`,
    `- cached input tokens: ${formatNumber(totals.cacheReadTokens)}`,
    `- cache-write input tokens: ${formatNumber(totals.cacheWriteTokens)}`,
    `- non-cached input tokens: ${formatNumber(totals.noCacheTokens)}`,
    `- raw provider output chars: ${formatNumber(totals.rawOutputChars)}`,
    '',
    '## Cache Prefix',
    '',
    `- first message stable: ${yesNo(report.stability.firstMessageStable)}`,
    `- first two messages stable: ${yesNo(report.stability.firstTwoMessagesStable)}`,
    `- provider instructions stable: ${yesNo(report.stability.providerInstructionsStable)}`,
    `- unique provider instruction hashes: ${report.stability.instructionHashes.join(', ') || '(none)'}`,
    `- provider instruction chars by request: ${instructionChars.map(formatNumber).join(', ')}`,
    `- message counts by request: ${messageCounts.join(', ')}`,
    `- last message roles by request: ${lastMessageRoles.join(', ')}`,
    `- common message-prefix chars vs previous request: ${commonMessagePrefixChars.map(formatNumber).join(', ')}`,
    `- request promptCacheKey values: ${requestPromptCacheKeys.join(', ') || '(none)'}`,
    `- prompt_cache_key values: ${promptCacheKeys.join(', ') || '(none)'}`,
    `- prompt_cache_retention values: ${promptCacheRetention.join(', ') || '(none)'}`,
    '',
    '## Warnings',
    '',
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ['- None.']),
    '',
    '## Per Request',
    '',
    '| # | Messages | Common prefix chars | Instructions chars | Input tokens | Cached tokens | Output tokens | Input chars | Output chars | Raw output chars | Prompt cache keys |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...requestsWithPrefixStats.map(
      (request) =>
        `| ${[
          request.sequence,
          request.messageCount,
          formatNumber(request.commonMessagePrefixChars),
          formatNumber(request.instructionsChars),
          request.inputTokens === null ? 'unavailable' : formatNumber(request.inputTokens),
          request.cacheReadTokens === null ? 'unavailable' : formatNumber(request.cacheReadTokens),
          request.outputTokens === null ? 'unavailable' : formatNumber(request.outputTokens),
          formatNumber(request.inputPayloadChars),
          formatNumber(request.outputPayloadChars),
          formatNumber(request.rawOutputChars),
          request.promptCacheKeys.join('<br>') || '',
        ].join(' | ')} |`,
    ),
    '',
  ]

  return lines.join('\n')
}

if (jsonOutput) console.log(JSON.stringify(report, null, 2))
else console.log(renderMarkdown())
