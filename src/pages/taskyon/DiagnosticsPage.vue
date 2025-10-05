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
          <div class="col-auto">
            <div class="text-caption">Available Tests:</div>
            <q-separator />
            <div>
              <q-list dense :padding="false">
                <q-item
                  v-for="(val, name) in { ...tests, ...guiTests }"
                  :key="name"
                  clickable
                  @click="runTests({ name: val }, true)"
                >
                  <q-item-section>{{ name }}</q-item-section>
                </q-item>
              </q-list>
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
import { useTaskyonStore } from 'stores/taskyonState'
import { ref } from 'vue'
import { exportFile } from 'quasar'
import { dump } from 'js-yaml'
import { copyToClipboard, getEnvironmentInfo } from 'src/modules/utils'
import { matContentCopy } from '@quasar/extras/material-icons'
import {
  markdownGeneration,
  testEstimateChatTokens,
  testPGLite,
  testTransformersPipeline,
  testVectorizerInitialization,
  testVectorizeText,
  testChatCompletion,
  testJsonSchemas,
  testToolLista,
  testJsonSchemaToYaml,
  testSecretStore,
  testGdriveZipRoundtrip,
  testPyodide,
  oauthTests,
  testArchiveUploadDownload,
  testMultipleArchiveUploadDownload,
  testTaskIdHashing,
  testCryptoSession,
  testIndexedDBKeyStorage,
  testSessionSwitching,
} from 'src/modules/taskyon/tests'
import { useAppStateStore } from 'src/stores/appState'
import TyResetButton from 'src/components/taskyon/TyResetButton.vue'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import { onMounted } from 'vue'
import { testCreateDeepTansformer } from 'src/modules/taskyon/tests'
import { testGdriveUpload } from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { convertTaskNodesToOpenAIChat, randomString } from '@taskyon/taskyon'
import { getCurrentProfileName, getStoredStateString } from 'src/modules/ui/initialState'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const diagnostics = ref<string>('')
const showPassWordDialog = ref(false)
const testFinished = ref(false)

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

async function completionMessage() {
  const ty = await tystate.taskyon
  const tyChat: Record<string, unknown> = {
    chatID: state.llmSettings.selectedTaskId,
  }
  if (state.llmSettings.selectedTaskId) {
    tyChat.taskIdChain = await ty.getTaskIdChain(state.llmSettings.selectedTaskId)
    const task = await ty.getTask(state.llmSettings.selectedTaskId)
    if (task) {
      const taskChain = await ty.getTaskChain(task.id, true)
      const toolDefs = await ty.updateToolDefinitions(false)
      const res = await convertTaskNodesToOpenAIChat(
        taskChain,
        // we are not testing files right now...
        () => new Promise(() => null),
        () => new Promise(() => undefined),
        state.llmSettings.tryUsingVisionModels,
        state.llmSettings.enableOpenAiTools,
        toolDefs,
      )
      tyChat.thread = res
    }
  }
  return tyChat
}

async function runTest(name: string, testFunc: () => unknown, details = false) {
  const result: Record<string, unknown> = {}
  console.log('run test:', name)
  try {
    const res = await testFunc()
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

const tests = {
  'test session switching': testSessionSwitching,
  'test key indexeddb storage': testIndexedDBKeyStorage,
  'test crypto session': testCryptoSession,
  'task hashing': testTaskIdHashing,
  'test Pyodide': testPyodide,
  'Test Secret Store': testSecretStore,
  'test json schema to yam conversion': testJsonSchemaToYaml,
  'test build slim view': testBuildSlimView,
  'test openrouter websearch chatCompletion': testChatCompletion,
  'test createDeeptransformer': testCreateDeepTansformer,
  'test chatCompletion tool': testChatCompletion,
  'environment info': getEnvironmentInfo,
  'list of Tools': testToolLista,
  'json schemas': testJsonSchemas,
  'pg lite': testPGLite,
  testTransformersPipeline: testTransformersPipeline,
  load_vecorization_initialization: testVectorizerInitialization,
  markdown_generation: markdownGeneration,
  test_token_counter: testEstimateChatTokens,
  test_vectorization: testVectorizeText,
  taskyon_data: getData,
  /*diagnostics.value += await runTest(
    'ipfs_helia_upload',
    testIPFS,
    details,
  );*/
}

const guiTests = {
  'test multiple archive upload gdrive': testMultipleArchiveUploadDownload,
  'test archive upload gdrive': testArchiveUploadDownload,
  'Test Gdrive zip file packets': testGdriveZipRoundtrip,
  'oAuth Tests': oauthTests,
  gdrive_upload: testGdriveUpload,
}

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

async function getData() {
  return dump(
    {
      browserInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        appName: navigator.appName,
        appVersion: navigator.appVersion,
        vendor: navigator.vendor,
        'crypto.subtle': crypto.subtle ? 'available' : 'not available',
      },
      windowInfo: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        colorDepth: window.screen.colorDepth,
      },
      appInfo: {
        appConfiguration: state.appConfiguration,
      },
      taskyonStoreDiagnostics: {
        currentProfilePointer: getCurrentProfileName(),
        SavedState: getStoredStateString(getCurrentProfileName()),
        CurrentState: state.getStateValues(),
      },
      CurrentChat: await completionMessage(),
    },
    { skipInvalid: true },
  )
}

function downloadReport() {
  const fileName = 'taskyon_diagnostics_report.yaml'
  const fileContent = JSON.stringify(diagnostics.value)
  const mimeType = 'application/json'

  exportFile(fileName, fileContent, mimeType)
}

void completionMessage()

//const stateView = {...state}
</script>
