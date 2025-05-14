<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md q-gutter-md">
        <div class="text-h5">Taskyon Diagnostics</div>
        <q-btn flat label="Return to App" to="/"></q-btn>
        <q-btn
          outline
          label="Generate Diagnostics Report"
          @click="generateReport(detailed, false)"
        ></q-btn>
        <q-btn outline label="Only run first test" @click="generateReport(detailed, true)"></q-btn>
        <q-btn outline label="IPFS status" to="ipfsmonitor"></q-btn>
        <q-btn v-if="diagnostics" outline label="download report" @click="downloadReport"></q-btn>
        <TyResetButton outline mode="all" />
        <TyResetButton outline mode="settings" />
        <q-toggle v-model="detailed" label="detailed"></q-toggle>
        <q-btn outline label="test iframe API" to="/clienttest" />
        <q-card flat bordered>
          <q-btn flat :icon="matContentCopy" @click="copyToClipboard(diagnostics)"></q-btn>
          <pre>{{ diagnostics }}</pre>
        </q-card>
      </q-page>
    </q-page-container>
    <password-request-dialog
      :info-text="infoText"
      v-model="showPassWordDialog"
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
} from 'src/modules/taskyon/tests'
import { useAppStateStore } from 'src/stores/appState'
import TyResetButton from 'src/components/taskyon/TyResetButton.vue'
import { chatThreadFromTaskId } from 'src/modules/tools/chatCompletionTool'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import { onMounted } from 'vue'
import { testCreateDeepTansformer } from 'src/modules/taskyon/tests'
import { testGdriveUpload } from 'src/modules/taskyon/tests'
import { testBuildSlimView } from 'src/modules/vueUtils'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const diagnostics = ref<string>('')
const detailed = ref(false)
const showPassWordDialog = ref(false)

const infoText = ref('get password')
let resolveSecret: (secret: string) => void
onMounted(async () => {
  const tm = await tystate.getTaskManager()
  tm.secretStore.requestInfos.subscribe((data) => {
    if (data.type === 'newSecret') {
      showPassWordDialog.value = true
      infoText.value = `Please enter the secret '${data.payload.secretName}' for '${data.payload.id}'`
      resolveSecret = data.respond
    }
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
          ? { message: error.message, stack: error.stack }
          : JSON.parse(JSON.stringify(error)),
    }
  }
  return dump(result, { skipInvalid: true })
}

async function generateReport(details = false, onlyFirst = false) {
  console.log('generating diagnostics report')

  diagnostics.value = `report_date: ${new Date().toISOString()}\n`

  diagnostics.value += await runTest('test build slim view', testJsonSchemaToYaml, details)

  // move this line behind the "first test"  in order to be able to test only the first test :)
  if (onlyFirst) {
    console.log('diagnostics:', diagnostics.value)
    return
  }

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
  //diagnostics.value += await runTest('Test Secret Store', testSecretStore, details)
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
  diagnostics.value += await runTest('gdrive_upload', testGdriveUpload, details)

  console.log('diagnostics:', diagnostics.value)
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
        SavedState: state.getStoredStateString(),
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
