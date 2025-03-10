<template>
  <div id="chat-container">
    <iframe
      id="taskyon"
      frameborder="0"
      src="https://taskyon.space"
      width="100%"
      height="100%"
    ></iframe>
  </div>
  <div id="output-container">
    <h2>Function Call Output</h2>
    <div id="output"></div>
  </div>
</template>

<script setup lang="ts">
import type { partialTyConfiguration } from 'src/modules/taskyon/iframeApiTypes'
import { createTool } from 'src/modules/taskyon/tools'
import { api } from 'src/modules/taskyon/tyClient'

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
      const outputDiv = document.getElementById('output')
      if (outputDiv) {
        const output = `Function called with parameters: ${JSON.stringify(
          data,
        )}<br>Returned: ${JSON.stringify(result)}`
        outputDiv.innerHTML = output
      }
      return result
    },
  }),
]

void api.initializeTaskyon(tools, configuration)
</script>
