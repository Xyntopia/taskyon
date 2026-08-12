import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { buildChatProviderRequest } from '@taskyon/taskyon/tools/chatCompletion/providerRequest'
import type { ChatCompletionProviderSettings, ProviderRequestTrace } from '@taskyon/taskyon'
import type { ModelMessage, LanguageModelUsage } from 'ai'
import { streamText } from 'ai'

const stableRootInstructions = [
  'Prompt-cache tree laboratory.',
  'Laboratory prefix version: stable-tree-v2.',
  'Treat every supplied conversation as immutable test data.',
  'Reply with only the word ready.',
  'Stable root padding follows:',
  'taskyon-cache-laboratory '.repeat(650),
].join('\n')

const paddedTurn = (branch: string, turn: number) =>
  [
    `${branch}, turn ${turn}. Preserve this exact branch history.`,
    `${branch}-turn-${turn}-payload `.repeat(180),
  ].join('\n')

const buildBranchMessages = (branch: string, depth: number): ModelMessage[] => [
  { role: 'system', content: stableRootInstructions },
  { role: 'user', content: 'Begin the shared root task.' },
  { role: 'assistant', content: 'The shared root task has begun.' },
  ...Array.from({ length: depth }, (_, index) => [
    { role: 'user' as const, content: paddedTurn(branch, index + 1) },
    {
      role: 'assistant' as const,
      content: `${branch}, turn ${index + 1} acknowledged without changing the test data.`,
    },
  ]).flat(),
  { role: 'user', content: 'Reply with only the word ready.' },
]

const tokenDetails = (usage: LanguageModelUsage) => ({
  inputTokens: usage.inputTokens,
  cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
  cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
  noCacheTokens: usage.inputTokenDetails.noCacheTokens,
  outputTokens: usage.outputTokens,
})

const summarizeUsages = (usages: LanguageModelUsage[]) => {
  const inputTokens = usages.reduce((total, usage) => total + (usage.inputTokens ?? 0), 0)
  const cacheReadTokens = usages.reduce(
    (total, usage) => total + (usage.inputTokenDetails.cacheReadTokens ?? 0),
    0,
  )
  return {
    inputTokens,
    cacheReadTokens,
    noCacheTokens: usages.reduce(
      (total, usage) => total + (usage.inputTokenDetails.noCacheTokens ?? 0),
      0,
    ),
    cacheReadPercent:
      inputTokens === 0 ? 0 : Number(((cacheReadTokens / inputTokens) * 100).toFixed(1)),
  }
}

export const testGpt56PromptCacheReusesIncreasingTreeBranches = async (
  context?: DiagnosticsTestContext,
) => {
  const api = (
    context?.toolchainConfig as { chatCompletion?: ChatCompletionProviderSettings } | undefined
  )?.chatCompletion
  if (!api || !context?.providerKey) {
    return { skipped: true, reason: 'No saved provider session is available.' }
  }
  if (
    (api.provider !== 'openai' && api.provider !== 'chatgpt-codex') ||
    !context.model?.includes('gpt-5.6')
  ) {
    return { skipped: true, reason: 'This release diagnostic requires an OpenAI GPT-5.6 model.' }
  }

  const branches = [
    { name: 'shallow', depth: 1 },
    { name: 'medium', depth: 2 },
    { name: 'deep', depth: 3 },
  ].map((branch) => ({ ...branch, messages: buildBranchMessages(branch.name, branch.depth) }))
  const passes: LanguageModelUsage[][] = []
  const requestBodies: string[][] = []

  for (let passIndex = 0; passIndex < 2; passIndex += 1) {
    const usages: LanguageModelUsage[] = []
    const bodies: string[] = []
    for (const branch of branches) {
      const taskId = `cache-laboratory-${branch.name}-pass-${passIndex + 1}`
      const providerRequest: ProviderRequestTrace = {
        provider: api.provider,
        model: context.model,
        taskId,
        recordedAt: new Date().toISOString(),
        attempts: [],
      }
      const request = await buildChatProviderRequest({
        messages: branch.messages,
        tools: {},
        selectedModel: context.model,
        api,
        apiKey: context.providerKey,
        providerRequest,
        promptCacheRootId: 'release-prompt-cache-tree-laboratory',
      })
      const completion = streamText({
        ...request,
        ...(api.provider === 'openai' ? { maxOutputTokens: 64 } : {}),
      })
      await completion.text
      const usage = await completion.totalUsage
      usages.push(usage)
      const requestBody = JSON.stringify(providerRequest.attempts[0]?.requestBody) ?? ''
      bodies.push(requestBody)
      console.log('Prompt-cache laboratory call', {
        pass: passIndex + 1,
        branch: branch.name,
        requestBytes: requestBody.length,
        ...tokenDetails(usage),
      })
    }
    passes.push(usages)
    requestBodies.push(bodies)
  }

  if (branches.some((_, index) => requestBodies[0]?.[index] !== requestBodies[1]?.[index])) {
    throw new Error('A repeated branch changed its provider request body between passes.')
  }

  const usages = passes.flat()
  const missingTelemetry = usages.some(
    (usage) =>
      usage.inputTokens === undefined ||
      usage.inputTokenDetails.cacheReadTokens === undefined ||
      usage.inputTokenDetails.noCacheTokens === undefined,
  )
  if (missingTelemetry) {
    throw new Error('GPT-5.6 prompt-cache token details were unavailable from the provider.')
  }

  const firstPassInputTokens = passes[0]?.map((usage) => usage.inputTokens ?? 0) ?? []
  if (
    firstPassInputTokens.length !== branches.length ||
    !firstPassInputTokens.every(
      (tokens, index) => index === 0 || tokens > firstPassInputTokens[index - 1]!,
    )
  ) {
    throw new Error(
      `Increasing branch depth did not produce increasing input sizes: ${JSON.stringify(firstPassInputTokens)}`,
    )
  }

  const secondPassCacheReadTokens = (passes[1] ?? []).reduce(
    (total, usage) => total + (usage.inputTokenDetails.cacheReadTokens ?? 0),
    0,
  )
  if (secondPassCacheReadTokens === 0) {
    throw new Error(
      `The repeated tree branches reported no cache reads: ${JSON.stringify(passes.map((pass) => pass.map(tokenDetails)))}`,
    )
  }

  const outputTokens = usages.reduce((total, usage) => total + (usage.outputTokens ?? 0), 0)
  if (outputTokens > 384) {
    throw new Error(`Prompt-cache laboratory exceeded its output ceiling: ${outputTokens} tokens.`)
  }

  return {
    cacheKeyScope: 'one shared task-tree root',
    branches: branches.map((branch, branchIndex) => ({
      name: branch.name,
      depth: branch.depth,
      messageCount: branch.messages.length,
      firstPass: tokenDetails(passes[0]![branchIndex]!),
      secondPass: tokenDetails(passes[1]![branchIndex]!),
    })),
    passTotals: {
      cold: summarizeUsages(passes[0]!),
      repeated: summarizeUsages(passes[1]!),
    },
    totals: {
      ...summarizeUsages(usages),
      outputTokens,
    },
  }
}

testGpt56PromptCacheReusesIncreasingTreeBranches.description =
  'Release laboratory: run three increasingly deep task-tree branches twice and measure cache reuse.'
testGpt56PromptCacheReusesIncreasingTreeBranches.modelBased = true
testGpt56PromptCacheReusesIncreasingTreeBranches.timeoutMs = 60_000
