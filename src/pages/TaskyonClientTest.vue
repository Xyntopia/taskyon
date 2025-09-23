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
      <div id="output">{{ functionResult }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ClientTool } from '@taskyon/taskyon'
import { createTool } from '@taskyon/taskyon'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { ref } from 'vue'
import { onMounted } from 'vue'
import { initializeTaskyon } from '../../packages/tyclient/src'

const taskyonUrl = window.location.origin

const functionResult = ref<string>()

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
    guiMode: 'default',
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

onMounted(() => void initializeTaskyon({ tools, configuration, name: 'taskyon client test' }))
</script>

<style lang="sass">
body
  background: grey !important
</style>
