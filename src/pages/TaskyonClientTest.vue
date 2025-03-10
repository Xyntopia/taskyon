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
import

// Configuration
const configuration = {
  llmSettings: {
    selectedApi: 'taskyon',
    enableOpenAiTools: false,
    llmApis: {
      taskyon: {
        selectedModel: 'meta-llama/llama-3.1-8b-instruct',
      },
    },
    taskTemplate: {
      allowedTools: ['myExampleStringAdderAlone'],
    },
  },
}

// Tool Definitions
const tools = [
  {
    id: 'simpleExampleTask.V1',
    name: 'myExampleStringAdderAlone',
    description: 'provide a short description which an AI can understand',
    longDescription: 'provide a long description if the AI/Human needs more details',
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
    },
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
  },
]
</script>
