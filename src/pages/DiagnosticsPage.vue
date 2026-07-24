<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md q-gutter-md">
        <div class="row">
          <div class="text-h5">Taskyon Diagnostics</div>
          <q-btn flat label="Return to App" to="/"></q-btn>
        </div>
        <div class="row">
          <q-btn
            data-cy="run-tests"
            outline
            label="Run all tests"
            :disable="isRunning"
            @click="generateReport(state.detailedTests, state.noGuiTests)"
          ></q-btn>
          <q-btn
            v-if="isRunning"
            color="negative"
            outline
            label="Abort tests"
            @click="abortRunningTests"
          />
          <q-chip
            dense
            square
            :color="isRunning ? 'primary' : 'grey-4'"
            :text-color="isRunning ? 'white' : 'grey-9'"
            data-cy="diagnostics-running-state"
          >
            <q-spinner v-if="isRunning" class="q-mr-xs" color="white" size="14px" />
            {{ isRunning ? 'Tests running' : 'Tests idle' }}
          </q-chip>
          <div>
            <q-toggle v-model="state.noGuiTests" label="no GUI Input"></q-toggle>
            <q-toggle v-model="state.detailedTests" label="detailed"></q-toggle>
          </div>
          <div>
            <q-btn flat label="open markdown test page" to="/md/tests/docs/markdown_it_test_page" />
            <q-btn flat label="IPFS status" to="ipfsmonitor"></q-btn>
            <q-btn
              v-if="diagnostics"
              outline
              label="download report"
              @click="downloadReport"
            ></q-btn>
            <TyResetButton flat mode="all" />
            <TyResetButton flat mode="settings" />
            <q-btn flat label="test iframe API" to="/clienttest" />
          </div>
        </div>
        <q-card flat bordered class="row items-top">
          <div class="column">
            <q-input
              v-model="searchQuery"
              dense
              clearable
              filled
              class="q-mb-sm"
              label="Filter tests"
              hint="Matches test function names (case-insensitive; ignores spaces and underscores)"
            />
            <div class="text-caption">Available Tests:</div>
            <div
              v-for="(section, sectionIdx) in filteredGroupedTestSections"
              :key="`${section.key}-${sectionIdx}`"
              class="col-auto"
            >
              <q-separator />
              <q-expansion-item
                :model-value="isSectionExpanded(section.key)"
                dense
                dense-toggle
                expand-separator
                @update:model-value="setSectionExpanded(section.key, $event)"
              >
                <template #header>
                  <q-item-section class="text-caption">{{ section.label }}</q-item-section>
                  <q-item-section side>
                    <q-btn
                      v-if="section.showRunAllButton"
                      dense
                      flat
                      size="sm"
                      label="run all"
                      @click.stop="runTests(section.allTests, state.detailedTests)"
                    />
                  </q-item-section>
                </template>
                <div
                  v-for="(groupName, groupIdx) in section.groupKeys"
                  :key="`${groupName}-${groupIdx}`"
                  class="col-auto"
                >
                  <q-expansion-item
                    :model-value="isGroupExpanded(section.key, groupName)"
                    dense
                    dense-toggle
                    expand-separator
                    @update:model-value="setGroupExpanded(section.key, groupName, $event)"
                  >
                    <template #header>
                      <q-item-section v-if="section.showGroupTitle" class="text-caption">
                        {{ groupName }}
                      </q-item-section>
                      <q-item-section v-else class="text-caption">Tests</q-item-section>
                      <q-item-section side>
                        <q-btn
                          v-if="section.showGroupRunButton"
                          dense
                          flat
                          size="sm"
                          label="run all"
                          @click.stop="
                            runTests(section.tests[groupName] ?? {}, state.detailedTests)
                          "
                        />
                      </q-item-section>
                    </template>
                    <div class="diagnostics-test-list">
                      <button
                        v-for="(val, name) in section.tests[groupName] ?? {}"
                        :key="name"
                        type="button"
                        class="diagnostics-test-button"
                        @click="runTests({ [`${name}`]: val }, true)"
                      >
                        {{ name }}
                      </button>
                    </div>
                  </q-expansion-item>
                </div>
              </q-expansion-item>
            </div>
          </div>
          <q-separator vertical />
          <div v-if="diagnostics" class="col" style="min-width: 300px; min-height: 500px">
            <q-btn flat :icon="matContentCopy" @click="copyToClipboard(diagnostics)"></q-btn>
            <q-scroll-area ref="diagnosticsScrollRef" class="fit" style="max-height: 90%">
              <pre data-cy="diagnostics-result">{{ diagnostics }}</pre>
            </q-scroll-area>
            <div v-if="testFinished" data-cy="test-finished">Test Finished</div>
          </div>
        </q-card>
      </q-page>
    </q-page-container>
    <password-request-dialog
      v-model="showPassWordDialog"
      :info-text="infoText"
      @ok="resolveSecret"
    />
  </q-layout>
</template>

<script setup lang="ts">
import { matContentCopy } from '@quasar/extras/material-icons'
import PasswordRequestDialog from '@taskyon/ui/components/PasswordRequestDialog.vue'
import { randomString } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import { exportFile } from 'quasar'
import TyResetButton from 'src/components/taskyon/TyResetButton.vue'
import * as ModelicaDiagnostics from '@taskyon/modelica/modelicaDiagnostics'
import { runMarkdownDetectionTests } from 'src/modules/taskyon/runMarkdownDetectionTests'
import * as TaskyonTests from 'src/modules/taskyon/tests'
import * as TaskyonUiInteractionTests from 'src/modules/taskyon/taskyonUiInteractionTests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  runTimeQuestionConversationUsesClockToolScenario,
  testTimeQuestionConversationUsesClockTool as packageTimeQuestionConversationTest,
} from '../../packages/taskyon/src/tests/conversation/test_time_question_conversation'
import {
  buildDiagnosticsRegistry,
  type DiagnosticsTestContext,
  runDiagnosticsTests,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import { syncRefsWithLocalStorage } from '@taskyon/common/modules/saveState'
import { copyToClipboard, getEnvironmentInfo } from '@taskyon/common/modules/utils'

const testModules = import.meta.glob(
  [
    '../../packages/runtime-browser/src/tests/**/*.ts',
    '../../packages/taskyon/src/tests/**/*.ts',
    '!../../packages/taskyon/src/tests/test_entry_node_error_recovery.ts',
    '!../../packages/taskyon/src/tests/test_entry_node_websearch.ts',
    '!../../packages/taskyon/src/tests/test_remote_function_bridge.ts',
    '!../../packages/taskyon/src/tests/test_taskyon.space_api.ts',
    '!../../packages/taskyon/src/tests/test_taskyon_documentation_conversation.ts',
    '!../../packages/taskyon/src/tests/test_task_worker_settlement.ts',
    '../../packages/common/modules/test_*.ts',
    '../../packages/comp-dag/test_*.ts',
    '../../packages/surrogate/test_*.ts',
  ],
  { eager: true }, // so modules are imported at build time (synchronously)
)
console.log('test modules:', testModules)

const tystate = useTaskyonStore()
const state = useAppStateStore()
const diagnostics = ref<string>('')
const showPassWordDialog = ref(false)
const testFinished = ref(false)
const searchQuery = ref('')
const isRunning = ref(false)
const abortRequested = ref(false)
const diagnosticsScrollRef = ref<{
  setScrollPercentage: (
    axis: 'vertical' | 'horizontal',
    percentage: number,
    duration?: number,
  ) => void
} | null>(null)

const infoText = ref('get password')
let resolveSecret: (secret: string) => void
onMounted(async () => {
  const ty = await tystate.taskyon
  void ty.onAskNewSecret(({ args: [{ id, secretName }], respond }) => {
    if (state.noGuiTests) {
      respond('randomKey' + randomString(5))
      return
    }
    showPassWordDialog.value = true
    infoText.value = `Please enter a test secret '${secretName}' for '${id}'`
    resolveSecret = respond
  })
})

const withDiagnosticsFlags = (
  mod: unknown,
  flagsByName: Record<string, Partial<Pick<TaskyonTestFn, 'experimental' | 'gui' | 'timeoutMs'>>>,
) =>
  Object.fromEntries(
    Object.entries((mod ?? {}) as Record<string, unknown>).map(([name, value]) => {
      if (typeof value !== 'function') return [name, value]
      const testFn = ((context?: DiagnosticsTestContext) =>
        Promise.resolve((value as TaskyonTestFn)(context))) as TaskyonTestFn
      Object.assign(testFn, value, flagsByName[name] ?? {})
      return [name, testFn]
    }),
  )

const modules = Object.entries(testModules).map(([sourcePath, mod]) => ({ sourcePath, mod }))
modules.push({
  sourcePath: 'src/modules/taskyon/tests.ts',
  mod: withDiagnosticsFlags(TaskyonTests, {
    testChatCompletionTaskyonProxyMetadata: { experimental: true },
    testChatCompletionTaskyonProxyMint: { experimental: true },
    testChatCompletionWebSearch: { experimental: true },
    testFileUpload: { experimental: true },
  }),
})
modules.push({
  sourcePath: 'src/modules/taskyon/taskyonUiInteractionTests.ts',
  mod: withDiagnosticsFlags(TaskyonUiInteractionTests, {
    testTaskyonUiSimpleChatInteraction: { gui: true },
    testTaskyonUiToolInteraction: { gui: true },
    testTaskyonUiListsAndUsesAvailableTools: { gui: true, timeoutMs: 420_000 },
    testTaskyonUiWebSearchInteraction: { gui: true },
  }),
})
modules.push({
  sourcePath: 'src/modules/modelica/modelicaDiagnostics.ts',
  mod: withDiagnosticsFlags(
    ModelicaDiagnostics,
    Object.fromEntries(
      Object.keys(ModelicaDiagnostics).map((name) => [name, { experimental: true }]),
    ),
  ),
})
modules.push({
  sourcePath: 'src/pages/DiagnosticsPage.vue',
  mod: {
    testTimeQuestionConversationUsesClockTool: Object.assign(
      async () => {
        const ty = await tystate.taskyon
        return await runTimeQuestionConversationUsesClockToolScenario(ty)
      },
      {
        description: packageTimeQuestionConversationTest.description,
        experimental: true,
        timeoutMs: packageTimeQuestionConversationTest.timeoutMs,
      },
    ),
  },
})

const registry = buildDiagnosticsRegistry({
  modules,
  builtins: [
    {
      testName: 'testBuildSlimView',
      func: testBuildSlimView as TaskyonTestFn,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
    {
      testName: 'getEnvironmentInfo',
      func: getEnvironmentInfo as TaskyonTestFn,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
    {
      testName: 'runMarkdownDetectionTests',
      func: runMarkdownDetectionTests as TaskyonTestFn,
      sourcePath: 'src/pages/DiagnosticsPage.vue',
    },
  ],
})

const guiTests = registry.guiTests
const tests = registry.tests
const experimentalTests = registry.experimentalTests
const testsByFolder = registry.testsByFolder
const testsByFile = registry.testsByFile
const testLists = { tests, experimentalTests, guiTests }
const testListKeys = Object.keys(testLists) as Array<keyof typeof testLists>

type GroupedSection = {
  key: string
  label: string
  tests: Record<string, TestRecord>
  allTests: TestRecord
  groupKeys: string[]
  showGroupTitle: boolean
  showGroupRunButton: boolean
  showRunAllButton: boolean
}

function toGroupedTests(source: TestRecord): Record<string, TestRecord> {
  return { all: source }
}

function flattenTestGroups(groups: Record<string, TestRecord>): TestRecord {
  return Object.values(groups).reduce((acc, current) => ({ ...acc, ...current }), {})
}

const groupedTestSections: GroupedSection[] = [
  ...testListKeys.map((key) => ({
    key: key,
    label: key,
    tests: toGroupedTests(testLists[key]),
    allTests: testLists[key],
    groupKeys: ['all'],
    showGroupTitle: false,
    showGroupRunButton: false,
    showRunAllButton: false,
  })),
  {
    key: 'by-folder',
    label: 'By Folder',
    tests: testsByFolder,
    allTests: flattenTestGroups(testsByFolder),
    groupKeys: Object.keys(testsByFolder).sort((a, b) => a.localeCompare(b)),
    showGroupTitle: true,
    showGroupRunButton: true,
    showRunAllButton: true,
  },
  {
    key: 'by-file',
    label: 'By File',
    tests: testsByFile,
    allTests: flattenTestGroups(testsByFile),
    groupKeys: Object.keys(testsByFile).sort((a, b) => a.localeCompare(b)),
    showGroupTitle: true,
    showGroupRunButton: true,
    showRunAllButton: true,
  },
]

const sectionExpanded = ref<Record<string, boolean>>({})
const groupExpanded = ref<Record<string, boolean>>({})

for (const section of groupedTestSections) {
  if (sectionExpanded.value[section.key] === undefined) sectionExpanded.value[section.key] = false

  for (const groupName of section.groupKeys) {
    const groupKey = `${section.key}::${groupName}`
    if (groupExpanded.value[groupKey] === undefined) groupExpanded.value[groupKey] = false
  }
}

function isSectionExpanded(sectionKey: string): boolean {
  return sectionExpanded.value[sectionKey] ?? false
}

function setSectionExpanded(sectionKey: string, value: boolean) {
  sectionExpanded.value[sectionKey] = value
}

function getGroupKey(sectionKey: string, groupName: string): string {
  return `${sectionKey}::${groupName}`
}

function isGroupExpanded(sectionKey: string, groupName: string): boolean {
  return groupExpanded.value[getGroupKey(sectionKey, groupName)] ?? false
}

function setGroupExpanded(sectionKey: string, groupName: string, value: boolean) {
  groupExpanded.value[getGroupKey(sectionKey, groupName)] = value
}

function normalizeSearchKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[\s_]+/g, '')
}

function filterTestRecordByName(source: TestRecord, normalizedNeedle: string): TestRecord {
  if (!normalizedNeedle) return source
  return Object.entries(source).reduce<TestRecord>((acc, [name, fn]) => {
    if (normalizeSearchKey(name).includes(normalizedNeedle)) acc[name] = fn
    return acc
  }, {})
}

const filteredGroupedTestSections = computed(() => {
  const normalizedNeedle = normalizeSearchKey(searchQuery.value)
  if (!normalizedNeedle) return groupedTestSections

  return groupedTestSections
    .map((section) => {
      const filteredTests = Object.entries(section.tests).reduce<Record<string, TestRecord>>(
        (acc, [groupName, groupTests]) => {
          const filteredGroup = filterTestRecordByName(groupTests, normalizedNeedle)
          if (Object.keys(filteredGroup).length > 0) acc[groupName] = filteredGroup
          return acc
        },
        {},
      )

      const groupKeys = section.groupKeys.filter((groupName) => filteredTests[groupName])
      if (groupKeys.length === 0) return null

      return {
        ...section,
        tests: filteredTests,
        groupKeys,
        allTests: flattenTestGroups(filteredTests),
      }
    })
    .filter((section): section is GroupedSection => section !== null)
})

syncRefsWithLocalStorage('taskyon.diagnostics.expansion', {
  sectionExpanded,
  groupExpanded,
  searchQuery,
})

async function scrollDiagnosticsToBottom() {
  await nextTick()
  diagnosticsScrollRef.value?.setScrollPercentage('vertical', 1)
}

function appendDiagnosticsLog(nextText: string) {
  diagnostics.value += nextText
  void scrollDiagnosticsToBottom()
}

async function runTests(tests: Record<string, TaskyonTestFn>, details = false) {
  if (isRunning.value) return
  isRunning.value = true
  abortRequested.value = false
  testFinished.value = false

  diagnostics.value = ''
  const startTime = Date.now() // milliseconds since epoch
  appendDiagnosticsLog(`report_date: ${new Date().toISOString()}\n`)
  let total = 0
  let failed = 0
  let aborted = false

  const tyauth = tystate.getTaskyonKeyString()
  const isCypress = typeof window !== 'undefined' && 'Cypress' in window
  const runOptions: Parameters<typeof runDiagnosticsTests>[1] = {
    details,
    isCypress,
    shouldAbort: () => abortRequested.value,
    onAbort: (nextTest) => {
      aborted = true
      appendDiagnosticsLog(`\nabort requested - skipped remaining tests (next: ${nextTest})\n`)
    },
    onProgress: ({ phase, test }) => {
      console.log(`diagnostics test ${phase}:`, test)
    },
    onResult: (result) => {
      total += 1
      if (!result.ok) failed += 1
      if (result.ok) {
        appendDiagnosticsLog(
          dump(
            {
              [result.name]: details
                ? {
                    status: 'OK',
                    result: result.details,
                  }
                : 'OK',
            },
            { skipInvalid: true, noRefs: true },
          ),
        )
      } else {
        appendDiagnosticsLog(
          dump(
            {
              [result.name]: {
                status: 'ERROR',
                message: 'an error occured during this test...',
                error: result.error,
              },
            },
            { skipInvalid: true, noRefs: true },
          ),
        )
      }
    },
  }
  if (typeof tyauth === 'string') runOptions.tyauth = tyauth

  try {
    await runDiagnosticsTests(tests, runOptions)

    appendDiagnosticsLog(`\n\ntime to run tests: ${(Date.now() - startTime) / 1000}s`)
    appendDiagnosticsLog(`\nfailed tests: ${failed}/${total}`)
    appendDiagnosticsLog(
      aborted ? '\naborted before all tests were finished' : '\nfinished all tests!',
    )
    console.log('diagnostics:', diagnostics.value)
    testFinished.value = true
  } finally {
    isRunning.value = false
  }
}

async function generateReport(details = false, noGui = true) {
  console.log('generating diagnostics report')

  // we run this test at the end, because sometimes it just keeps blocking?
  if (noGui) await runTests(tests, details)
  else await runTests({ ...tests, ...guiTests }, details)
}

function downloadReport() {
  const fileName = 'taskyon_diagnostics_report.yaml'
  const fileContent = JSON.stringify(diagnostics.value)
  const mimeType = 'application/json'

  exportFile(fileName, fileContent, mimeType)
}

function abortRunningTests() {
  if (!isRunning.value) return
  abortRequested.value = true
}

//const stateView = {...state}
</script>

<style scoped>
.diagnostics-test-list {
  display: flex;
  flex-direction: column;
}

.diagnostics-test-button {
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  min-height: 32px;
  padding: 4px 16px;
  text-align: left;
}

.diagnostics-test-button:hover,
.diagnostics-test-button:focus-visible {
  background: rgb(0 0 0 / 8%);
  outline: none;
}
</style>
