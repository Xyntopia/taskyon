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
import { until } from '@vueuse/core'
import { dump } from 'js-yaml'
import * as ModelicaDiagnostics from '@taskyon/modelica/modelicaDiagnostics'
import { runMarkdownDetectionTests } from 'src/modules/taskyon/runMarkdownDetectionTests'
import * as TaskyonTests from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  buildDiagnosticsRegistry,
  getDiagnosticsSkipReason,
  runDiagnosticsTests,
  type DiagnosticsRunOptions,
  type DiagnosticsTestContext,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'

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

const emitHeadlessEvents = computed(() => route.query.emit === '1')
const HEADLESS_KEEP_TAG = '[HEADLESS][KEEP]'

async function emitHeadlessEvent(name: string, payload: Record<string, unknown>) {
  if (!emitHeadlessEvents.value) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(name, payload)
  } catch (error) {
    console.error(`${HEADLESS_KEEP_TAG}[EMIT][ERROR] failed to emit event`, {
      name,
      payload,
      error,
    })
  }
}

function getDiagnosticsTests() {
  const testModules = import.meta.glob(
    [
      '../../../packages/runtime-browser/src/tests/**/*.ts',
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
    mod: ModelicaDiagnostics,
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
    ? { ...registry.tests, ...registry.modelBasedTests }
    : {
        ...registry.tests,
        ...registry.modelBasedTests,
        ...registry.guiTests,
      }

  if (diagnosticsIncludeLargeTokens.value) return selectedTests

  return Object.fromEntries(
    Object.entries(selectedTests).filter(([, fn]) => !fn.requiresLargeTokens),
  )
}

function normalizeTestFilter(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
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

function summarizeError(error: unknown): string {
  if (!error) return 'unknown error'
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
  }
  try {
    return JSON.stringify(error)
  } catch {
    return Object.prototype.toString.call(error)
  }
}

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch (error) {
    console.error(`${HEADLESS_KEEP_TAG}[WINDOW][ERROR] failed to close window`, error)
  }
}

async function runDiagnosticsMode() {
  status.value = 'running diagnostics'
  console.log(`${HEADLESS_KEEP_TAG}[DIAG][START] diagnostics mode started`)

  const start = Date.now()
  const filterArg = typeof route.query.testFilter === 'string' ? route.query.testFilter.trim() : ''
  const allTests = getDiagnosticsTests()
  const tests = filterArg ? applyTestFilter(allTests, filterArg) : allTests
  if (filterArg) {
    console.log(
      `${HEADLESS_KEEP_TAG}[DIAG][FILTER] diagnostics filter "${filterArg}" matched ${Object.keys(tests).length}/${Object.keys(allTests).length} tests`,
    )
  }
  if (!Object.keys(tests).length) {
    throw new Error(`No diagnostics tests matched filter: "${filterArg}"`)
  }
  const modelArg = route.query.diagnosticsModel
  const diagnosticModel = typeof modelArg === 'string' ? modelArg : undefined
  if (
    diagnosticModel &&
    diagnosticModel !== 'openai/gpt-5.6-luna' &&
    diagnosticModel !== 'z-ai/glm-5.3-flash'
  ) {
    throw new Error('Invalid Taskyon model for workflow diagnostics')
  }
  const createRunOptions = (model?: string): DiagnosticsRunOptions => ({
    details: diagnosticsDetailed.value,
    context: {
      allowLongRun: route.query.allowLongRun === '1',
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
      await until(() => state.tyready.value).toBe(true, { timeout: 30_000 })
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
    onProgress: (progress) => {
      void emitHeadlessEvent('headless-diagnostics-progress', {
        phase: progress.phase,
        test: progress.test,
        ok: progress.ok,
        errorMessage: progress.ok === false ? summarizeError(progress.error) : undefined,
      })
    },
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

  await emitHeadlessEvent('headless-diagnostics-result', {
    passed,
    total,
    failed,
    modelPassed,
    modelTotal: modelResults.length,
  })

  status.value = passed ? 'diagnostics passed' : 'diagnostics failed'
  if (route.query.close === '1') {
    await closeWindow()
  }
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
    await until(() => state.tyready.value).toBe(true, { timeout: 30_000 })
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
    await emitHeadlessEvent('headless-diagnostics-result', {
      passed: false,
      total: 0,
      failed: 1,
    })
    if (route.query.close === '1') {
      await closeWindow()
    }
  }
})
</script>
