<template>
  <q-page class="q-pa-md">
    <div>Taskyon headless mode</div>
    <div>Status: {{ status }}</div>
    <div v-if="peerId">Peer ID: {{ peerId }}</div>
    <div>Topic: {{ chatTopic }}</div>
    <div v-if="runDiagnostics">Diagnostics mode: active</div>
  </q-page>
</template>

<script setup lang="ts">
import { chatCompletionProviderSettings } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import * as ModelicaDiagnostics from '@taskyon/modelica/modelicaDiagnostics'
import { collectModelicaDiagnosticTests } from '@taskyon/modelica/modelicaDiagnosticVariants'
import { runMarkdownDetectionTests } from 'src/modules/taskyon/runMarkdownDetectionTests'
import * as TaskyonTests from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  buildDiagnosticsRegistry,
  getDiagnosticsSkipReason,
  runDiagnosticsTests,
  selectDiagnosticsTestBatch,
  type DiagnosticsRunOptions,
  type DiagnosticsTestContext,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import {
  filterDiagnosticsThroughLevel,
  parseDiagnosticsRunLevel,
  type DiagnosticsRunLevel,
} from '@taskyon/common/modules/diagnosticsLevels'
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'
import { awaitRuntimeReadiness } from '@taskyon/common/modules/runtimeReadiness'

const route = useRoute()
const status = ref('booting')
const peerId = ref<string | null>(null)
const started = ref(false)

const runDiagnostics = computed(() => route.query.runDiagnostics === '1')
const diagnosticsDetailed = computed(() => route.query.details === '1')
const diagnosticsNoGui = computed(() => route.query.nogui !== '0')
const diagnosticsIncludeLargeTokens = computed(() => route.query.largeTokens === '1')

const chatTopic = computed(() => {
  const topic = route.query.topic
  if (typeof topic === 'string' && topic.trim()) return topic.trim()
  return 'taskyon-simple-chat'
})

const shouldReportHeadlessResult = computed(() => route.query.emit === '1')
const HEADLESS_KEEP_TAG = '[HEADLESS][KEEP]'

function emitHeadlessResult(payload: {
  passed: boolean
  total: number
  failed: number
  modelPassed?: number
  modelTotal?: number
}) {
  if (!shouldReportHeadlessResult.value) return
  console.info(`${HEADLESS_KEEP_TAG}[RESULT] ${JSON.stringify(payload)}`)
}

function getDiagnosticsTests(throughLevel?: DiagnosticsRunLevel) {
  const testModules = import.meta.glob(
    [
      '../../../packages/runtime-browser/src/tests/**/test_*.ts',
      '../../../packages/taskyon/src/tests/**/*.ts',
      '!../../../packages/taskyon/src/tests/test_ai_workstation_graph.ts',
      '!../../../packages/taskyon/src/tests/test_public_design_repositories.ts',
      '!../../../packages/taskyon/src/tests/test_taskyon_documentation_conversation.ts',
      '../../../packages/common/modules/test_*.ts',
      '../../../packages/comp-dag/test_*.ts',
      '../../../packages/surrogate/test_*.ts',
    ],
    { eager: true },
  )
  const modules = Object.entries(testModules).map(([sourcePath, mod]) => ({ sourcePath, mod }))
  modules.push({ sourcePath: 'src/modules/taskyon/tests.ts', mod: TaskyonTests })
  modules.push({
    sourcePath: 'src/modules/modelica/modelicaDiagnostics.ts',
    mod: collectModelicaDiagnosticTests(ModelicaDiagnostics),
  })
  const builtins: Array<{ testName: string; func: TaskyonTestFn; sourcePath: string }> = [
    {
      testName: 'testBuildSlimView',
      func: testBuildSlimView,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
    {
      testName: 'getEnvironmentInfo',
      func: getEnvironmentInfo as TaskyonTestFn,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
    {
      testName: 'runMarkdownDetectionTests',
      func: runMarkdownDetectionTests,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
  ]

  const registry = buildDiagnosticsRegistry({
    modules,
    builtins,
  })

  const selectedTests = diagnosticsNoGui.value
    ? {
        ...registry.tests,
        ...registry.modelBasedTests,
        ...(throughLevel !== undefined && throughLevel >= 3 ? registry.experimentalTests : {}),
      }
    : {
        ...registry.tests,
        ...registry.modelBasedTests,
        ...registry.guiTests,
        ...(throughLevel !== undefined && throughLevel >= 3 ? registry.experimentalTests : {}),
      }

  if (diagnosticsIncludeLargeTokens.value || (throughLevel !== undefined && throughLevel >= 3)) {
    return selectedTests
  }

  return Object.fromEntries(
    Object.entries(selectedTests).filter(([, fn]) => !fn.requiresLargeTokens),
  )
}

function normalizeTestFilter(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function parseDiagnosticsBatchNumber(value: unknown, minimum: number): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined
}

function applyTestFilter(tests: TestRecord, filter: string): TestRecord {
  const normalizedFilter = normalizeTestFilter(filter)
  return Object.fromEntries(
    Object.entries(tests).filter(([name]) => normalizeTestFilter(name).includes(normalizedFilter)),
  )
}

function diagnosticsYamlReport(results: Awaited<ReturnType<typeof runDiagnosticsTests>>) {
  let out = `report_date: ${new Date().toISOString()}\n`
  for (const result of results) {
    const skippedReason = getDiagnosticsSkipReason(result.details)
    if (skippedReason !== undefined) {
      out += dump(
        {
          [result.name]: {
            status: 'SKIPPED',
            reason: skippedReason,
          },
        },
        { skipInvalid: true, noRefs: true },
      )
      continue
    }
    if (result.ok) {
      out += dump(
        {
          [result.name]: diagnosticsDetailed.value
            ? {
                status: result.modelBased ? 'MODEL PASS' : 'OK',
                result: result.details,
              }
            : result.modelBased
              ? 'MODEL PASS'
              : 'OK',
        },
        { skipInvalid: true, noRefs: true },
      )
      continue
    }

    out += dump(
      {
        [result.name]: {
          status: result.modelBased && !result.preparationFailed ? 'MODEL MISS' : 'ERROR',
          message:
            result.modelBased && !result.preparationFailed
              ? 'The selected model did not satisfy this capability evaluation.'
              : 'An error occurred during this test.',
          error: result.error,
        },
      },
      { skipInvalid: true, noRefs: true },
    )
  }
  return out
}

async function runDiagnosticsMode() {
  status.value = 'running diagnostics'
  console.log(`${HEADLESS_KEEP_TAG}[DIAG][START] diagnostics mode started`)

  const start = Date.now()
  const progressLines: string[] = []
  let progressFlushTimer: ReturnType<typeof setTimeout> | undefined
  const flushProgress = () => {
    if (progressFlushTimer !== undefined) clearTimeout(progressFlushTimer)
    progressFlushTimer = undefined
    if (progressLines.length === 0) return
    console.log(`${HEADLESS_KEEP_TAG}[TEST] ${progressLines.splice(0).join(' | ')}`)
  }
  const recordProgress: NonNullable<DiagnosticsRunOptions['onProgress']> = (progress) => {
    const status =
      progress.ok === undefined ? '' : progress.ok ? ' (OK)' : ` (ERROR) ${String(progress.error)}`
    progressLines.push(`${progress.phase.toUpperCase()} ${progress.test}${status}`)
    if (progressLines.length >= 40) {
      flushProgress()
      return
    }
    if (progressFlushTimer === undefined) {
      progressFlushTimer = setTimeout(flushProgress, 2_000)
    }
  }
  const filterArg = typeof route.query.testFilter === 'string' ? route.query.testFilter.trim() : ''
  const throughLevel =
    route.query.throughLevel === undefined
      ? undefined
      : parseDiagnosticsRunLevel(route.query.throughLevel)
  const allTests = getDiagnosticsTests(throughLevel)
  const matchingNames = filterArg ? applyTestFilter(allTests, filterArg) : allTests
  const levelFilteredTests =
    throughLevel === undefined
      ? matchingNames
      : filterDiagnosticsThroughLevel(matchingNames, throughLevel)
  const testOffset = parseDiagnosticsBatchNumber(route.query.testOffset, 0) ?? 0
  const testLimit = parseDiagnosticsBatchNumber(route.query.testLimit, 1)
  const tests = selectDiagnosticsTestBatch(levelFilteredTests, testOffset, testLimit)
  if (filterArg) {
    console.log(
      `${HEADLESS_KEEP_TAG}[DIAG][FILTER] diagnostics filter "${filterArg}" matched ${Object.keys(levelFilteredTests).length}/${Object.keys(allTests).length} tests`,
    )
  }
  if (testOffset > 0 || testLimit !== undefined) {
    console.log(
      `${HEADLESS_KEEP_TAG}[DIAG][BATCH] selected ${Object.keys(tests).length}/${Object.keys(levelFilteredTests).length} tests at offset ${testOffset}`,
    )
  }
  if (!Object.keys(tests).length) {
    throw new Error(
      Object.keys(levelFilteredTests).length === 0
        ? `No diagnostics tests matched filter: "${filterArg}" at level ${throughLevel ?? 'all'}`
        : `No diagnostics tests selected at offset ${testOffset}`,
    )
  }
  const modelArg = route.query.diagnosticsModel
  const diagnosticModel = typeof modelArg === 'string' ? modelArg : undefined
  if (
    diagnosticModel &&
    diagnosticModel !== 'openai/gpt-6-luna' &&
    diagnosticModel !== 'z-ai/glm-5.3-flash'
  ) {
    throw new Error('Invalid Taskyon model for workflow diagnostics')
  }
  const createRunOptions = (model?: string): DiagnosticsRunOptions => ({
    details: diagnosticsDetailed.value,
    context: {
      allowLongRun:
        route.query.allowLongRun === '1' || (throughLevel !== undefined && throughLevel >= 3),
    },
    contextForTest: async (_name: string, test: TaskyonTestFn, context: DiagnosticsTestContext) => {
      if (!test.modelBased && !test.requiresAuth) return context
      const [{ useAppStateStore }, { useTaskyonStore }] = await Promise.all([
        import('src/stores/appState'),
        import('src/stores/taskyonState'),
      ])
      const appState = useAppStateStore()
      await appState.awaitConfigurationReady()
      if (context.abortSignal?.aborted) throw new Error('Diagnostic preparation was canceled')
      appState.appConfiguration.enableGdriveSync = false
      const state = useTaskyonStore()
      await awaitRuntimeReadiness(state.taskyon)
      if (context.abortSignal?.aborted) throw new Error('Diagnostic preparation was canceled')
      let tyauth = state.getTaskyonKeyString()
      if (!tyauth) {
        await state.initModelsAndStoredKeys()
        tyauth = state.getTaskyonKeyString()
      }
      const chatCompletionConfig = appState.effectiveToolchainConfig.chatCompletion
      const providerSettings = chatCompletionProviderSettings.safeParse(chatCompletionConfig)
      const selectedApi = providerSettings.success ? providerSettings.data.provider : undefined
      const selectedModel = model ?? state.currentModelId
      if (model && (selectedApi !== 'taskyon' || !providerSettings.success)) {
        throw new Error('The requested diagnostic model requires the Taskyon provider')
      }
      return {
        ...context,
        ...(tyauth ? { tyauth } : {}),
        ...(selectedApi ? { selectedApi } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        llmSettings: appState.llmSettings,
        toolchainConfig:
          model && providerSettings.success
            ? {
                ...appState.effectiveToolchainConfig,
                chatCompletion: { ...providerSettings.data, model: selectedModel },
              }
            : appState.effectiveToolchainConfig,
        workflowDiagnosticsHost: state.workflowDiagnosticsHost,
        storageClient: state.storageClient,
        storageDownload: state.storageDownload,
        ...(selectedApi
          ? {
              providerSession: state.createDiagnosticsProviderSession(selectedApi, selectedModel),
            }
          : {}),
      }
    },
    onProgress: recordProgress,
    onResult: (result) => {
      if (!result.ok && (!result.modelBased || result.preparationFailed)) {
        console.error(`${HEADLESS_KEEP_TAG}[TEST][FAIL] ${result.name}`, result.error)
      }
    },
  })
  const namedTests = diagnosticModel
    ? Object.fromEntries(
        Object.entries(tests).map(([name, fn]) => [`${name} [${diagnosticModel}]`, fn]),
      )
    : tests
  const results = await runDiagnosticsTests(namedTests, createRunOptions(diagnosticModel))
  flushProgress()

  const total = results.length
  const executableResults = results.filter(
    (result) => getDiagnosticsSkipReason(result.details) === undefined,
  )
  const failed = executableResults.filter((result) => !result.ok).length
  const modelResults = executableResults.filter(
    (result) => result.modelBased && !result.preparationFailed,
  )
  const modelPassed = modelResults.filter((result) => result.ok).length
  const passed = failed === 0
  const report = diagnosticsYamlReport(results)
  const elapsed = (Date.now() - start) / 1000

  console.log(
    `${HEADLESS_KEEP_TAG}[DIAG][YAML] HEADLESS_DIAGNOSTICS_YAML_START\n${report}\nHEADLESS_DIAGNOSTICS_YAML_END`,
  )
  console.log(`${HEADLESS_KEEP_TAG}[DIAG][END] diagnostics finished`, {
    total,
    failed,
    modelPassed,
    modelTotal: modelResults.length,
    passed,
    elapsedSeconds: elapsed,
  })

  emitHeadlessResult({
    passed,
    total,
    failed,
    modelPassed,
    modelTotal: modelResults.length,
  })

  status.value = passed ? 'diagnostics passed' : 'diagnostics failed'
}

onMounted(async () => {
  if (started.value) return
  started.value = true

  try {
    if (runDiagnostics.value) {
      await runDiagnosticsMode()
      return
    }

    status.value = 'waiting for taskyon core'
    const [{ useTaskyonStore }, { getActiveP2pNode }] = await Promise.all([
      import('src/stores/taskyonState'),
      import('@taskyon/taskyon'),
    ])
    const state = useTaskyonStore()
    await awaitRuntimeReadiness(state.taskyon)
    const p2p = getActiveP2pNode()
    status.value = 'starting p2p'
    await p2p.start({ chatTopic: chatTopic.value })
    peerId.value = (await p2p.id()) ?? null
    status.value = 'running'

    console.log(`${HEADLESS_KEEP_TAG}[OPS][START] Taskyon headless mode started`, {
      topic: chatTopic.value,
      peerId: peerId.value,
    })
  } catch (error) {
    status.value = 'error'
    console.error(`${HEADLESS_KEEP_TAG}[BOOT][ERROR] failed to boot headless mode`, error)
    emitHeadlessResult({
      passed: false,
      total: 0,
      failed: 1,
    })
  }
})
</script>
