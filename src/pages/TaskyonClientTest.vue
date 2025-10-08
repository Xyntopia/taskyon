<template>
  <div class="column">
    <div class="col-6">
      <!--We load the iframe here with the iframe=true parameter to make test in cypress work!-->
      <iframe
        id="taskyon"
        frameborder="0"
        :src="`${taskyonUrl}?iframe=true&profile=test`"
        width="100%"
        height="500px"
      ></iframe>
    </div>
    <div class="col-6">
      <div>Function Call Output</div>
      <q-btn outline label="Execute Client Test Function" @click="startClientTest" />
      <div class="q-pa-lg">function result: {{ functionResult }}</div>
      <pre class="q-pa-lg" style="max-width: 500px; white-space: pre-wrap; word-break: break-word">
        received async result. {{ JSON.stringify(taskResult, undefined, 2) }}</pre
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onMounted } from 'vue'
import type {
  partialTyConfiguration,
  ClientTool,
  TyClient,
  partialTaskDraft,
} from '../../packages/tyclient/src'
import {
  initializeTaskyon,
  createTool,
  createChatCompletionTask,
} from '../../packages/tyclient/src'
import { freeKey } from 'src/assets/taskyon_free_key.json'

const taskyonUrl = window.location.origin

const functionResult = ref<string>()
const tyclient = ref<TyClient>()
const taskResult = ref<unknown>()

// Configuration
const configuration: partialTyConfiguration = {
  llmSettings: {
    selectedApi: 'taskyon',
    enableOpenAiTools: false,
    enableToolChooser: true,
    llmApis: {
      taskyon: {
        selectedModel: 'meta-llama/llama-3.3-70b-instruct',
      },
    },
  },
  appConfiguration: {
    expertMode: true,
    darkTheme: false,
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
  createTool({
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
    } as const,
    function: (data) => {
      console.log('client received function call with data:', data)
      const result = `${data.parameter1}${data.parameter2}`
      functionResult.value = result
      return result
    },
  }),
]

onMounted(async () => {
  tyclient.value = await initializeTaskyon({ tools, configuration, name: 'taskyon client test' })
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
          data: 'Awesome! now can you add two strings for me? PLease use the clientTest tool!',
        },
      },
      createChatCompletionTask({ goal: 'ChooseTool', allowedTools: ['clientTest'] }),
    ],
  ]
  /*const unsub = tyclient.value?.port.receive((msg) => {
    console.log('client received message from iframe:', msg)
  })*/
  try {
    const res = await tyclient.value?.processTasks(tasks, { timeoutMs: 50000 })
    taskResult.value = res
    console.log('client received result:')
  } catch (error) {
    console.error('client process task resulted in error:', error)
    taskResult.value = 'error!'
  }
  //unsub?.()
}
</script>

<style lang="sass">
body
  background-color: $green-8 !important

body::before
  content: none !important
  background: none !important
</style>
