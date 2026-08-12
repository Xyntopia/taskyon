export type DiagnosticsTestMetadata = {
  requiresAuth?: boolean
  requiresNetwork?: boolean
  requiresLargeTokens?: boolean
  requiresLongRun?: boolean
  modelBased?: boolean
  release?: boolean
}

export type UnsupportedModuleFallback = {
  reason: string
  tests: Array<{
    exportName: string
    experimental?: boolean
  }>
}

export const diagnosticsTestMetadata: Record<string, DiagnosticsTestMetadata> = {
  testTimeQuestionConversationUsesClockTool: {
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
  testTyProxy: {
    requiresAuth: true,
    requiresNetwork: true,
  },
  testTauriHttpPluginHttpsFetch: {
    requiresNetwork: true,
  },
  testSharedHeadlessBrowserDiscoveryFixture: {
    requiresNetwork: true,
  },
  testNodeDiscoveryThroughLocalRelay: {
    requiresNetwork: true,
  },
  testEntryNodeRecoversFromMalformedPythonToolCall: {
    requiresNetwork: true,
    modelBased: true,
  },
  testEntryNodeWebsearchProducesHostedSearchUsage: {
    requiresNetwork: true,
    modelBased: true,
  },
  testCliHelloWorldProducesAssistantResponse: {
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
  testCliAiWorkstationCreatesAndOptimizesDagGraph: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testWebResearchPlannerEnablesBrowserSetupAndWebSearchByDefault: {
    requiresLargeTokens: true,
  },
  testTaskyonCliConversationUsesDocumentationTool: {
    requiresNetwork: true,
    requiresLargeTokens: true,
    modelBased: true,
  },
  testGpt56PromptCacheReusesIncreasingTreeBranches: {
    requiresNetwork: true,
    modelBased: true,
    release: true,
  },
}

export const unsupportedModuleFallbacks: Record<string, UnsupportedModuleFallback> = {}
