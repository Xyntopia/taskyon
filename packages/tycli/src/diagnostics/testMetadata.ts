export type DiagnosticsTestMetadata = {
  requiresAuth?: boolean
  requiresNetwork?: boolean
  requiresLargeTokens?: boolean
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
  },
  testEntryNodeWebsearchProducesHostedSearchUsage: {
    requiresNetwork: true,
  },
  testCliHelloWorldProducesAssistantResponse: {
    requiresNetwork: true,
  },
  testCliListsAndUsesAvailableTools: {
    requiresNetwork: true,
    requiresLargeTokens: true,
  },
  testCliDocumentationQuestionCompletesWithoutFatal: {
    requiresNetwork: true,
    requiresLargeTokens: true,
  },
  testCliTaskPlannerUsesContractedSequentialHandoffs: {
    requiresNetwork: true,
    requiresLargeTokens: true,
  },
  testWebResearchPlannerEnablesBrowserSetupAndWebSearchByDefault: {
    requiresLargeTokens: true,
  },
  testTaskyonCliConversationUsesDocumentationTool: {
    requiresNetwork: true,
    requiresLargeTokens: true,
  },
}

export const unsupportedModuleFallbacks: Record<string, UnsupportedModuleFallback> = {
  'test_taskyon.space_api.ts': {
    reason:
      'Skipped in the Node diagnostics harness: this module currently depends on TypeScript syntax/runtime paths that are not portable through Node strip-types alone.',
    tests: [
      { exportName: 'testTokenMinting' },
      { exportName: 'testTokenMintClaims' },
      { exportName: 'testTokenMintSecurity' },
      { exportName: 'testTokenReturnAfterJwtExpButBeforeOms', experimental: true },
      { exportName: 'testTokenReturnAfterOms', experimental: true },
      { exportName: 'testSecureFetch', experimental: true },
      { exportName: 'testTyProxy' },
      { exportName: 'testTauriHttpPluginHttpsFetch' },
      { exportName: 'testWasmHttpsTunne' },
    ],
  },
}
