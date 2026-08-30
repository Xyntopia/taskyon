import { readFile } from 'node:fs/promises'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const submissionPaths = [
  {
    name: 'browser',
    file: new URL('../../../../ui/components/taskyon/TaskComposer.vue', import.meta.url),
    owner: 'const submitTask = async',
    createChain: 'props.client.task.createChain({',
  },
  {
    name: 'CLI',
    file: new URL('../../cli.ts', import.meta.url),
    owner: 'async function createCliTaskChain(',
    createChain: 'engine.taskyonApi.task.createChain({',
  },
] as const

export const testBrowserAndCliSubmitMessagesThroughSharedWorkflow = async () => {
  for (const { name, file, owner, createChain } of submissionPaths) {
    const source = await readFile(file, 'utf8')
    const ownerIndex = source.indexOf(owner)
    const builderIndex = source.indexOf('const taskChain = buildCreateNewTaskChain({', ownerIndex)
    const submissionIndex = source.indexOf(createChain, builderIndex)

    assert(ownerIndex >= 0, `Missing ${name} message submission owner`)
    assert(builderIndex > ownerIndex, `${name} must use the shared message-chain builder`)
    assert(
      submissionIndex > builderIndex && submissionIndex - builderIndex < 1500,
      `${name} must submit the shared builder's result`,
    )
    assert(
      /\btasks:\s*taskChain\b/.test(source.slice(submissionIndex, submissionIndex + 220)),
      `${name} must pass the shared taskChain to createChain`,
    )
  }

  const browserStore = await readFile(
    new URL('../../../../../src/stores/taskyonState.ts', import.meta.url),
    'utf8',
  )
  const cli = await readFile(new URL('../../cli.ts', import.meta.url), 'utf8')
  assert(
    browserStore.includes('createStandardEntryNodeTool({') &&
      cli.includes('createStandardEntryNodeTool({'),
    'Browser and CLI must both register the standard EntryNode implementation',
  )
  assert(
    browserStore.includes('toolSetup: createBrowserToolSetup') &&
      browserStore.includes('createToolSetup: createBrowserToolSetup') &&
      browserStore.includes('const host = await registerBrowserWorkflowTools(ty)') &&
      browserStore.includes('return await registerBrowserWorkflowTools(ty, extraTools)'),
    'Browser diagnostics must reuse the real browser chat tool setup and registrations',
  )
  const browserDiagnostics = await readFile(
    new URL('../../../../../src/pages/DiagnosticsPage.vue', import.meta.url),
    'utf8',
  )
  const headlessDiagnostics = await readFile(
    new URL('../../../../../src/pages/taskyon/HeadlessPage.vue', import.meta.url),
    'utf8',
  )
  assert(
    browserStore.includes('toolchainConfig: stateRefs.effectiveToolchainConfig') &&
      browserDiagnostics.includes('toolchainConfig: state.effectiveToolchainConfig') &&
      headlessDiagnostics.includes('toolchainConfig:') &&
      headlessDiagnostics.includes('appState.effectiveToolchainConfig'),
    'Browser chat and both diagnostics entry points must use their active effective toolchain',
  )
  return { checkedHosts: ['browser', 'CLI'] }
}

testBrowserAndCliSubmitMessagesThroughSharedWorkflow.description =
  'Checks that both host submission paths call the shared builder and register the standard EntryNode.'

export const testCliWorkflowDiagnosticsReuseChatRegistration = async () => {
  const cli = await readFile(new URL('../../cli.ts', import.meta.url), 'utf8')
  const diagnostics = await readFile(new URL('../runDiagnostics.ts', import.meta.url), 'utf8')
  assert(
    cli.includes('const workflowHost = createCliWorkflowHost('),
    'CLI chat must use the shared host factory',
  )
  assert(
    cli.includes('toolSetup: workflowHost.createToolSetup('),
    'CLI core setup must use the shared host tool setup',
  )
  assert(
    /workflowHost\.registerTools\(/.test(cli),
    'CLI chat must use the shared tool registration',
  )
  assert(
    diagnostics.includes('workflowDiagnosticsHost: createCliWorkflowHost('),
    'Diagnostics must supply the real CLI host',
  )
  assert(
    diagnostics.includes('wrapped.requiresLongRun = requiresLongRun'),
    'CLI wrappers must preserve the long-run opt-in requirement',
  )
}
