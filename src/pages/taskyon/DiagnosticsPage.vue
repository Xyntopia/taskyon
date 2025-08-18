<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md q-gutter-md">
        <div class="row">
          <div class="text-h5">Taskyon Diagnostics</div>
          <q-btn flat label="Return to App" to="/"></q-btn>
        </div>
        <q-btn
          outline
          label="Only run first test"
          @click="generateReport(state.detailedTests, false, true)"
        ></q-btn>
        <q-btn
          outline
          label="Generate Diagnostics Report"
          @click="generateReport(state.detailedTests, state.noGuiTests, false)"
        ></q-btn>
        <div>
          <q-toggle v-model="state.noGuiTests" label="no GUI Input"></q-toggle>
          <q-toggle v-model="state.detailedTests" label="detailed"></q-toggle>
        </div>
        <q-btn flat label="open markdown test page" to="/docs/markdown_it_test_page" />
        <q-btn flat label="IPFS status" to="ipfsmonitor"></q-btn>
        <q-btn v-if="diagnostics" outline label="download report" @click="downloadReport"></q-btn>
        <TyResetButton flat mode="all" />
        <TyResetButton flat mode="settings" />
        <q-btn flat label="test iframe API" to="/clienttest" />
        <q-card flat bordered>
          <q-btn flat :icon="matContentCopy" @click="copyToClipboard(diagnostics)"></q-btn>
          <pre data-cy="diagnostics-result">{{ diagnostics }}</pre>
          <div v-if="testFinished" data-cy="test-finished">Test Finished</div>
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
} from 'src/modules/taskyon/tests'
import { useAppStateStore } from 'src/stores/appState'
import TyResetButton from 'src/components/taskyon/TyResetButton.vue'
import { chatThreadFromTaskId } from 'src/modules/tools/chatCompletionTool'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import { onMounted } from 'vue'
import { testCreateDeepTansformer } from 'src/modules/taskyon/tests'
import { testGdriveUpload } from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'
import { randomString } from 'src/modules/crypto_js'
import { getStoredStateString } from 'src/modules/ui/initialState'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const diagnostics = ref<string>('')
const showPassWordDialog = ref(false)
const testFinished = ref(false)

const infoText = ref('get password')
let resolveSecret: (secret: string) => void
onMounted(() => {
  void tystate.secretStore.onNewSecret(({ args: [{ id, secretName }], respond }) => {
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
  const tm = await tystate.getTaskManager()
  const tyChat: Record<string, unknown> = {
    chatID: state.llmSettings.selectedTaskId,
  }
  if (state.llmSettings.selectedTaskId) {
    tyChat.taskIdChain = await tm.getTaskIdChain(state.llmSettings.selectedTaskId)
    const task = await (await tystate.getTaskManager()).getTask(state.llmSettings.selectedTaskId)
    if (task) {
      const toolDefs = await tm.updateToolDefinitions(false)
      const res = await chatThreadFromTaskId(tm, task.id, state.llmSettings, toolDefs)
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
  return dump(result, { skipInvalid: true })
}

async function generateReport(details = false, noGui = true, onlyFirst = false) {
  console.log('generating diagnostics report')
  testFinished.value = false

  const startTime = Date.now() // milliseconds since epoch
  diagnostics.value = `report_date: ${new Date().toISOString()}\n`

  diagnostics.value += await runTest('Test Secret Store', testGdriveZipRoundtrip, details)

  // move this line behind the "first test"  in order to be able to test only the first test :)
  if (onlyFirst) {
    console.log('diagnostics:', diagnostics.value)
    return
  }

  diagnostics.value += await runTest(
    'Test Gdrive zip file packets',
    testSecretStore(tystate.secretStore),
    details,
  )

  diagnostics.value += await runTest(
    'test json schema to yam conversion',
    testJsonSchemaToYaml,
    details,
  )
  diagnostics.value += await runTest('test build slim view', testBuildSlimView, details)

  diagnostics.value += await runTest(
    'test openrouter websearch chatCompletion',
    testChatCompletion,
    details,
  )

  diagnostics.value += await runTest(
    'test createDeeptransformer',
    testCreateDeepTansformer,
    details,
  )
  diagnostics.value += await runTest('test chatCompletion tool', testChatCompletion, details)
  diagnostics.value += await runTest('environment info', getEnvironmentInfo)
  diagnostics.value += await runTest('list of Tools', testToolLista, details)
  diagnostics.value += await runTest('json schemas', testJsonSchemas, details)
  diagnostics.value += await runTest('pg lite', testPGLite, details)

  /*diagnostics.value += await runTest(
    'ipfs_helia_upload',
    testIPFS,
    details,
  );*/

  diagnostics.value += await runTest('testTransformersPipeline', testTransformersPipeline, details)
  diagnostics.value += await runTest(
    'load_vecorization_initialization',
    testVectorizerInitialization,
    details,
  )
  diagnostics.value += await runTest('markdown_generation', markdownGeneration, details)
  diagnostics.value += await runTest('test_token_counter', testEstimateChatTokens, details)
  diagnostics.value += await runTest('test_vectorization', testVectorizeText, details)
  diagnostics.value += await runTest('taskyon_data', getData, details)
  // we run this test at the end, because sometimes it just keeps blocking?
  if (!noGui) diagnostics.value += await runTest('gdrive_upload', testGdriveUpload, details)

  diagnostics.value += `\n\ntime to run tests: ${(startTime - Date.now()) / 1000}s`
  diagnostics.value += '\nfinished all tests!'
  console.log('diagnostics:', diagnostics.value)
  testFinished.value = true
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
        SavedState: getStoredStateString(),
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
