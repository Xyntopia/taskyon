<template>
  <div class="column">
    <div class="col-6">
      <!--We load the iframe here with the iframe=true parameter to make embedded e2e tests work.-->
      <iframe id="taskyon" frameborder="0" :src="iframeSrc" width="100%" height="500px"></iframe>
    </div>
    <div class="row">
      <div class="col-6">
        <q-toggle v-model="dev" label="switch between taskyon.space <-> dev versions" />
        <div>Function Call Output</div>
        <q-btn
          outline
          label="Execute Client Test Function"
          :disable="!clientReady"
          @click="startClientTest"
        />
        <div v-if="clientReady" data-cy="client-ready" class="text-caption">client ready</div>
        <div id="output" class="q-pa-lg">function result: {{ functionResult }}</div>
        received async result.
        <pre
          v-if="taskResult"
          data-cy="task-result"
          class="q-pa-lg"
          style="max-width: 500px; white-space: pre-wrap; word-break: break-word"
        >
        {{ JSON.stringify(taskResult, undefined, 2) }}</pre
        >
      </div>
      <div>
        <q-btn outline label="Test file upload and reading" @click="startFileUpload" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onMounted } from 'vue'
import type {
  partialTyConfiguration,
  ClientTool,
  TyClient,
  partialTaskDraft,
} from '@taskyon/tyclient'
import { initializeTaskyon, createClientTool, createChatCompletionTask } from '@taskyon/tyclient'
import { freeKey } from 'src/assets/taskyon_free_key'
import type { JSONSchema7 } from 'json-schema'
import { useAppStateStore } from 'src/stores/appState'

const dev = ref(true)
const taskyonUrl = computed(() => (dev.value ? window.location.origin : 'https://taskyon.space'))
const profileName = 'client_test_page'
const state = useAppStateStore()
const iframeSrc = computed(() => {
  const params = new URLSearchParams({
    iframe: 'true',
    profile: profileName,
  })
  if (!state.bindingKey) {
    params.set('nobindingkey', '1')
  }
  return `${taskyonUrl.value}?${params.toString()}`
})

const functionResult = ref<string>()
const tyclient = ref<TyClient>()
const taskResult = ref<unknown>()
const clientReady = ref(false)

// Configuration
const configuration: partialTyConfiguration = {
  llmSettings: {
    selectedApi: 'taskyon',
    llmApis: {
      taskyon: {
        selectedModel: 'meta-llama/llama-3.3-70b-instruct',
      },
    },
  },
  toolchainConfig: {
    entryNode: {
      use_tool_chooser: true,
    },
  },
  appConfiguration: {
    expertMode: true,
    showLogo: false,
    chatSuggestions: [],
    darkTheme: true,
    primaryColor: '#f00',
    secondaryColor: '#f0f',
    // we are using "default" GUI mode for debugging purposes!, in production, change this to "iframe"
    // or leave it out :)
    guiMode: 'minChat',
  },

  signatureOrKey: freeKey,
}

// Tool Definitions
const tools: ClientTool[] = [
  createClientTool({
    name: 'clientTest',
    description: 'function which adds two strings on this page and displays them!',
    parameters: {
      type: 'object',
      properties: {
        parameter1: {
          type: 'string',
          description: 'This is an example parameter!',
        },
        parameter2: {
          type: 'string',
          description: 'This is another example parameter, but not required!',
        },
      },
      required: ['parameter1'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (data) => {
      console.log('client received function call with data:', data)
      const formatParameter = (value: unknown) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : (JSON.stringify(value) ?? '')
      const result = `${formatParameter(data.parameter1)}${formatParameter(data.parameter2)}`
      functionResult.value = result
      return result
    },
  }),
]

onMounted(async () => {
  tyclient.value = await initializeTaskyon({
    tools,
    configuration,
    name: profileName,
    iframeId: 'taskyon',
    ...(state.bindingKey ? { bindingKey: state.bindingKey } : {}),
  })
  clientReady.value = true
})

async function startClientTest() {
  const tasks: partialTaskDraft[][] = [
    [
      {
        role: 'assistant',
        content: { type: 'message', data: 'We are strating to test the client!' },
      },
      {
        role: 'user',
        content: {
          type: 'message',
          data: 'Awesome! now can you add these two strings for me:  “cypress” and “test function”? PLease use the clientTest tool!',
        },
      },
      createChatCompletionTask({ allowedTools: ['clientTest'] }),
    ],
  ]
  /*const unsub = tyclient.value?.port.receive((msg) => {
    console.log('client received message from iframe:', msg)
  })*/
  try {
    const res = await tyclient.value?.runTasks(tasks, 'message', {
      timeoutMs: 50000,
      display: 'activeChat',
    })
    taskResult.value = res
    console.log('client received result:')
  } catch (error) {
    console.error('client process task resulted in error:', error)
    taskResult.value = 'error!'
  }
  //unsub?.()
}

async function urlToFile(url: string, filename?: string): Promise<File> {
  const res = await fetch(url)

  // auto-detect MIME type from response headers
  const mimeType = res.headers.get('Content-Type') ?? 'application/octet-stream'

  const blob = await res.blob()
  return new File([blob], filename ?? url.split('/').pop() ?? 'file', { type: mimeType })
}

async function startFileUpload() {
  const testPdf = await urlToFile('/tests/product_specs_long.pdf')
  if (!tyclient.value) return

  const [id] = await tyclient.value.sendFiles([testPdf])
  if (!id) throw new Error('Expected uploaded file id')
  console.log('finished sending file!', id)

  // now we can send
  const res = await tyclient.value?.runTasks(
    [
      [
        {
          role: 'system',
          content: { type: 'files', data: [id] },
        },
        {
          role: 'user',
          content: {
            type: 'message',
            data: 'The user uploaded a pdf file, can you show me whats in it?',
          },
        },
        createChatCompletionTask({}),
      ],
    ],
    'message',
    { timeoutMs: 50000, display: 'activeChat' },
  )
  taskResult.value = res
  console.log('client received result:')
}
</script>

<style lang="sass">
body
  background-color: $green-4 !important

body::before
  content: none !important
  background: none !important
</style>
