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
            @click="generateReport(state.detailedTests, state.noGuiTests)"
          ></q-btn>
          <div>
            <q-toggle v-model="state.noGuiTests" label="no GUI Input"></q-toggle>
            <q-toggle v-model="state.detailedTests" label="detailed"></q-toggle>
          </div>
          <div>
            <q-btn flat label="open markdown test page" to="/docs/markdown_it_test_page" />
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
            <div class="text-caption">Available Tests:</div>
            <div v-for="(testListName, idx) in testListKeys" :key="idx" class="col-auto">
              <q-separator />
              <div class="text-caption">{{ testListName }}</div>
              <div>
                <q-list dense :padding="false">
                  <q-item
                    v-for="(val, name) in testLists[testListName] ?? {}"
                    :key="name"
                    clickable
                    @click="runTests({ [`${name}`]: val }, true)"
                  >
                    <q-item-section>{{ name }}</q-item-section>
                  </q-item>
                </q-list>
              </div>
            </div>
          </div>
          <q-separator vertical />
          <div v-if="diagnostics" class="col" style="min-width: 300px; min-height: 500px">
            <q-btn flat :icon="matContentCopy" @click="copyToClipboard(diagnostics)"></q-btn>
            <q-scroll-area class="fit" style="max-height: 90%">
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
import { randomString } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import { exportFile } from 'quasar'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import TyResetButton from 'src/components/taskyon/TyResetButton.vue'
import { runMarkdownDetectionTests } from 'src/modules/taskyon/runMarkdownDetectionTests'
import * as TaskyonTests from 'src/modules/taskyon/tests'
import { copyToClipboard, getEnvironmentInfo } from 'src/modules/utils'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { onMounted, ref } from 'vue'

const testModules = import.meta.glob(
  '../../packages/taskyon/src/tests/**/*.ts',
  { eager: true }, // so modules are imported at build time (synchronously)
)
console.log('test modules:', testModules)

const tystate = useTaskyonStore()
const state = useAppStateStore()
const diagnostics = ref<string>('')
const showPassWordDialog = ref(false)
const testFinished = ref(false)

function camelToNormal(input: string): string {
  if (!input) return ''

  // Insert a space before all caps
  const withSpaces = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar → foo Bar
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // HTMLParser → HTML Parser

  // Optionally lowercase everything except first character
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

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

async function runTest(name: string, testFunc: TaskyonTestFn, details = false) {
  const tyauth = tystate.getTaskyonKeyString()
  const result: Record<string, unknown> = {}
  console.log('run test:', name)
  try {
    const res = await testFunc({ tyauth })
    if (details) {
      result[name] = {
        status: 'OK',
        result: res,
      }
    } else {
      result[name] = 'OK'
    }
  } catch (error) {
    console.log(error)
    result[name] = {
      status: 'ERROR',
      message: 'an error occured during this test...',
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack, cause: error.cause, name: error.name }
          : JSON.parse(JSON.stringify(error)),
    }
  }
  return dump(result, { skipInvalid: true, noRefs: true })
}

export interface TaskyonTestFn {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  (opts?: { tyauth?: string | undefined }): Promise<unknown> | unknown
  description?: string
  gui?: boolean
}

const guiTests = {} as Record<string, TaskyonTestFn>
const tests = {} as Record<string, TaskyonTestFn>
const experimentalTests = {} as Record<string, TaskyonTestFn>
const testLists = {
  tests,
  experimentalTests,
  guiTests,
}
const testListKeys = Object.keys(testLists) as Array<keyof typeof testLists>

tests.testBuildSlimView = testBuildSlimView
tests.getEnvironmentInfo = getEnvironmentInfo
tests.runMarkdownDetectionTests = runMarkdownDetectionTests

const modules = Object.entries(testModules).map(([path, mod]) => {
  console.log('add test', path)
  return mod
})
modules.push(TaskyonTests)

modules.forEach((mod) => {
  if (!mod || typeof mod !== 'object') return
  Object.entries(mod).forEach(([name, func]) => {
    if (typeof func !== 'function') return
    else if ('helper' in func) return
    else if ('gui' in func) guiTests[camelToNormal(String(name))] = func
    else if ('experimental' in func) experimentalTests[camelToNormal(String(name))] = func
    else tests[camelToNormal(String(name))] = func
  })
})

async function runTests(tests: Record<string, () => unknown>, details = false) {
  testFinished.value = false

  diagnostics.value = ''
  const startTime = Date.now() // milliseconds since epoch
  diagnostics.value = `report_date: ${new Date().toISOString()}\n`

  /*diagnostics.value += (
    await Promise.all(Object.entries(tests).map(([name, f]) => runTest(name, f, details)))
  ).join('\n')*/
  for (const [name, f] of Object.entries(tests)) {
    diagnostics.value += await runTest(name, f, details)
    console.log('running test:', name)
  }

  testFinished.value = true
  diagnostics.value += `\n\ntime to run tests: ${(Date.now() - startTime) / 1000}s`
  diagnostics.value += '\nfinished all tests!'
  console.log('diagnostics:', diagnostics.value)
  testFinished.value = true
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

//const stateView = {...state}
</script>
