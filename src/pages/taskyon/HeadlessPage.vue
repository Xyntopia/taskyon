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
import { getActiveP2pNode } from '@taskyon/taskyon'
import { until } from '@vueuse/core'
import { dump } from 'js-yaml'
import * as ModelicaDiagnostics from '@taskyon/modelica/modelicaDiagnostics'
import { runMarkdownDetectionTests } from 'src/modules/taskyon/runMarkdownDetectionTests'
import * as TaskyonTests from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { useAppStateStore } from 'src/stores/appState'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  buildDiagnosticsRegistry,
  runDiagnosticsTests,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'

const route = useRoute()
const state = useTaskyonStore()
const appState = useAppStateStore()
const p2p = getActiveP2pNode()
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
      '../../packages/taskyon/src/tests/**/*.ts',
      '../../packages/common/modules/test_*.ts',
      '../../packages/comp-dag/test_*.ts',
      '../../packages/surrogate/test_*.ts',
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
          status: result.modelBased ? 'MODEL MISS' : 'ERROR',
          message: result.modelBased
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
  let tyauth = state.getTaskyonKeyString()
  if (typeof tyauth !== 'string' || tyauth.length === 0) {
    // Headless boots quickly and can race key initialization from the store.
    await state.initModelsAndStoredKeys()
    tyauth = state.getTaskyonKeyString()
  }
  const chatCompletionConfig = appState.effectiveToolchainConfig.chatCompletion
  const selectedApi =
    typeof chatCompletionConfig === 'object' &&
    chatCompletionConfig !== null &&
    'provider' in chatCompletionConfig &&
    typeof chatCompletionConfig.provider === 'string'
      ? chatCompletionConfig.provider
      : undefined
  const providerKey = selectedApi ? await state.getProviderApiKey(selectedApi) : null
  const runOptions: Parameters<typeof runDiagnosticsTests>[1] = {
    details: diagnosticsDetailed.value,
    context: {
      ...(typeof tyauth === 'string' ? { tyauth } : {}),
      ...(selectedApi ? { selectedApi } : {}),
      ...(state.currentModelId ? { model: state.currentModelId } : {}),
      llmSettings: appState.llmSettings,
      toolchainConfig: appState.effectiveToolchainConfig,
      ...(typeof providerKey === 'string' ? { providerKey } : {}),
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
      if (!result.ok && !result.modelBased) {
        console.error(`${HEADLESS_KEEP_TAG}[TEST][FAIL] ${result.name}`, result.error)
      }
    },
  }
  const results = await runDiagnosticsTests(tests, runOptions)

  const total = results.length
  const failed = results.filter((result) => !result.ok && !result.modelBased).length
  const modelResults = results.filter((result) => result.modelBased)
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
      appState.appConfiguration.enableGdriveSync = false
    }
    status.value = 'waiting for taskyon core'
    await until(() => state.tyready.value).toBe(true, { timeout: 30_000 })

    if (runDiagnostics.value) {
      await runDiagnosticsMode()
      return
    }

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
