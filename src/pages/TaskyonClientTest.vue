<template>
  <div class="column">
    <div class="col-6">
      <!--We load the iframe here with the iframe=true parameter to make test in cypress work!-->
      <iframe
        id="taskyon"
        frameborder="0"
        :src="`${taskyonUrl}?iframe=true`"
        width="100%"
        height="500px"
      ></iframe>
    </div>
    <div class="col-6">
      <div>Function Call Output</div>
      <q-btn outline label="Execute Client Test Function" @click="startClientTest" />
      <div class="q-pa-lg">function result: {{ functionResult }}</div>
      <div class="q-pa-lg">received async result. {{}}</div>
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
import type { TaskNode } from '../../packages/tyclient/dist/tyclient'

const taskyonUrl = window.location.origin

const functionResult = ref<string>()
const tyclient = ref<TyClient>()
const taskResult = ref<TaskNode>()

// Configuration
const configuration: partialTyConfiguration = {
  llmSettings: {
    selectedApi: 'taskyon',
    enableOpenAiTools: false,
    enableToolChooser: true,
    /*llmApis: {
      taskyon: {
        selectedModel: 'meta-llama/llama-3.1-8b-instruct',
      },
    },*/
  },
  appConfiguration: {
    expertMode: true,
    darkTheme: true,
    primaryColor: '#f00',
    secondaryColor: '#0ff',
    // we are using "default" GUI mode for debugging purposes!, in production, change this to "iframe"
    // or leave it out :)
    guiMode: 'auto',
  },
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
      console.log('Received function call with data:', data)
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
        content: { type: 'message', data: 'Awesome! now can you add two strings for me?' },
      },
      createChatCompletionTask({ goal: 'ChooseTool' }),
    ],
  ]
  const res = await tyclient.value?.processTasks(tasks)

  taskResult.value = res?.task
}
</script>

<style lang="sass">
body
  background: grey !important
</style>
