import type { TaskyonTestFn, TestRecord } from './diagnosticsRunner'

export const diagnosticsRunLevels = [
  { value: 1, label: 'L1 · Quick smoke' },
  { value: 2, label: 'L2 · Broad fast checks' },
  { value: 3, label: 'L3 · Release checks' },
  { value: 4, label: 'L4 · Quality evaluations' },
] as const

export type DiagnosticsRunLevel = (typeof diagnosticsRunLevels)[number]['value']

export type DiagnosticsTestMetadata = {
  requiresAuth?: boolean
  requiresNetwork?: boolean
  requiresLargeTokens?: boolean
  requiresLongRun?: boolean
  modelBased?: boolean
  level?: DiagnosticsRunLevel
}

export const diagnosticsTestMetadata: Record<string, DiagnosticsTestMetadata> = {
  testCombinedWorkflowRequiresSearchBeforeFinalComputation: { level: 1 },
  testIdealWorkflowGuardStopsUnexpectedFollowUp: { level: 1 },
  testDiagnosticsRunnerSkipsLongRunWithoutPermission: { level: 1 },
  testFocusedToolSearchMatchesCamelCaseNames: { level: 1 },
  testVueTemplatesUseSvgIcons: { level: 1 },
  testToolSearchVisibilityIsIndependentOfTaskIndexing: { level: 1 },
  testIdealWorkflowGuardAllowsCombinedSearchContinuation: { level: 1 },
  testIdealWorkflowGuardStopsUnexpectedWebsearchTool: { level: 1 },
  testIdealWorkflowGuardIgnoresProgressTextBeforeToolUse: { level: 1 },
  testFocusedToolSearcherRejectsGenericPartialMatches: { level: 1 },
  testDiagnosticsRunnerPreparesOnlyTheSelectedTest: { level: 1 },
  testBrowserAndCliSubmitMessagesThroughSharedWorkflow: { level: 1 },
  testSimplePinnedToolConversationUsesNormalTaskyonFlow: {
    requiresNetwork: true,
    modelBased: true,
  },
  testSimpleGreetingConversationUsesNormalTaskyonFlow: {
    requiresNetwork: true,
    modelBased: true,
  },
  testTokenMinting: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTokenMintClaims: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testInstanceBoundTokenSettlement: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTokenMintSecurity: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTokenReturnAfterJwtExpButBeforeOms: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTokenReturnAfterOms: {
    requiresAuth: true,
    requiresNetwork: true,
    requiresLongRun: true,
  },
  testSecureFetch: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTauriHttpPluginHttpsFetch: {
    requiresNetwork: true,
  },
  testOpenCodeModelListsLoadWithoutKey: {
    requiresNetwork: true,
  },
  testSharedHeadlessBrowserDiscoveryFixture: {
    requiresNetwork: true,
  },
  testNodeDiscoveryThroughLocalRelay: {
    requiresNetwork: true,
  },
  testSecureFetchRustTlsThroughLocalRelay: {
    requiresNetwork: true,
  },
  testEntryNodeRecoversFromPythonExecutionFailure: {
    requiresNetwork: true,
    modelBased: true,
  },
  testEntryNodeRecoversFromMalformedPythonToolCall: {
    requiresNetwork: true,
    modelBased: true,
  },
  testEntryNodeWebsearchProducesHostedSearchUsage: {
    requiresNetwork: true,
    modelBased: true,
  },
  testWebSearchThenToolUsesSearchedValue: {
    requiresNetwork: true,
    modelBased: true,
  },
  testCatalogSearchThenUsesDiscoveredTool: {
    requiresNetwork: true,
    modelBased: true,
  },
  testIdealWorkflowMatrixWithLunaAndGlm: {
    requiresNetwork: true,
    requiresLongRun: true,
    modelBased: true,
    level: 3,
  },
  testDocumentRetrievalStoresOfficialFederalRulesPdf: {
    requiresNetwork: true,
    modelBased: true,
    level: 3,
  },
  testCliHelloWorldProducesAssistantResponse: {
    requiresNetwork: true,
  },
  testCliFocusedSearchFindsANonPinnedTool: {
    requiresNetwork: true,
    modelBased: true,
  },
  testCliListsAndUsesAvailableTools: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testCliDocumentationQuestionCompletesWithoutFatal: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testCliTaskPlannerUsesContractedSequentialHandoffs: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testCliCreatesAndRunsDagGraphProject: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
    level: 3,
  },
  testCliComparesDagGraphWorkstationOptions: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
    level: 3,
  },
  testTaskyonCliConversationUsesDocumentationTool: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testGpt6LunaPromptCacheReusesIncreasingTreeBranches: {
    requiresNetwork: true,
    modelBased: true,
    level: 3,
  },
}

export function diagnosticsTestIdentifier(name: string): string {
  if (/^test[A-Z]/.test(name)) return name
  const normalizedName = name.replace(/^Test\s+/i, '')
  const camelName = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +([a-z0-9])/g, (_, chr: string) => chr.toUpperCase())
  if (camelName.startsWith('test') && camelName.length > 4) return camelName
  return camelName.replace(/^([a-z])/, (_, chr: string) => `test${chr.toUpperCase()}`)
}

export function parseDiagnosticsRunLevel(input: unknown): DiagnosticsRunLevel {
  const value = typeof input === 'string' && input.trim() ? Number(input) : input
  const level = diagnosticsRunLevels.find((entry) => entry.value === value)
  if (!level) throw new Error('Run level must be a whole number from 1 to 4.')
  return level.value
}

export function getDiagnosticsRunLevel(name: string, test: TaskyonTestFn): DiagnosticsRunLevel {
  const metadata = diagnosticsTestMetadata[diagnosticsTestIdentifier(name)]
  if (metadata?.level !== undefined) return metadata.level
  if (test.experimental) return 3
  if (metadata?.requiresLongRun || test.requiresLongRun) return 3
  if (metadata?.requiresLargeTokens || test.requiresLargeTokens) return 3
  if (metadata?.modelBased || test.modelBased) return 3
  if (metadata?.requiresNetwork || metadata?.requiresAuth || test.requiresAuth) return 3
  if (test.timeoutMs !== undefined && test.timeoutMs > 30_000) return 3
  return 2
}

export function filterDiagnosticsThroughLevel(
  tests: TestRecord,
  maxLevel: DiagnosticsRunLevel,
): TestRecord {
  return Object.fromEntries(
    Object.entries(tests).filter(([name, test]) => getDiagnosticsRunLevel(name, test) <= maxLevel),
  )
}
