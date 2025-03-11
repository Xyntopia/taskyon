<template>
  <div class="column">
    <div class="col-6">
      <iframe
        id="taskyon"
        frameborder="0"
        src="http://localhost:9000"
        width="100%"
        height="500px"
      ></iframe>
    </div>
    <div class="col-6">
      <h2>Function Call Output</h2>
      <div>{{ functionResult }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { partialTyConfiguration } from 'src/modules/taskyon/iframeApiTypes'
import { createTool } from 'src/modules/taskyon/tools'
import { api } from 'src/modules/client/tyClient'
import { ref } from 'vue'

const functionResult = ref<string>()

// Configuration
const configuration: partialTyConfiguration = {
  llmSettings: {
    selectedApi: 'taskyon',
    enableOpenAiTools: false,
    llmApis: {
      taskyon: {
        selectedModel: 'meta-llama/llama-3.1-8b-instruct',
      },
    },
    allowedTools: ['myExampleStringAdderAlone'],
  },
  appConfiguration: {
    expertMode: true,
    // we are using "default" GUI mode for debugging purposes!, in production, change this to "iframe"
    // or leave it out :)
    guiMode: 'default',
  },
}

// Tool Definitions
const tools = [
  createTool({
    name: 'mywebpage functionality',
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
    } as const,
    function: (data) => {
      console.log('Received function call with data:', data)
      const result = `${data.parameter1}${data.parameter2}`
      functionResult.value = result
      return result
    },
  }),
]

void api.initializeTaskyon(tools, configuration)
</script>
