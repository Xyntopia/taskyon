// we can compile this file to js using:
// swc --config-file ./swcrc exampleToolDefinition.ts -o exampleToolDefinition.js
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object')
    factory(exports);
  else if (typeof define === 'function' && define.amd)
    define(['exports'], factory);
  else if (
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self)
  )
    factory((global.exampleToolDefinition = {}));
})(this, function (exports) {
  'use strict';
  Object.defineProperty(exports, '__esModule', {
    value: true,
  });
  const configuration = {
    model: 'llama-3',
    config_signature: '2o8zbackwughbck73tqbc3r',
  };
  const tools = [
    {
      id: 'simpleExampleTask.V1',
      name: 'myExampleStringAdderAlone',
      description: 'provide a short description which an AI can understand',
      longDescription:
        'provide a long description if the AI/Human needs more details',
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
        console.log('Received function call with data:', data);
        const result = `${data.parameter1}${data.parameter2}`;
        const outputDiv = document.getElementById('output');
        if (outputDiv) {
          // Display function call information
          const output = `Function called with parameters: ${JSON.stringify(
            data
          )}<br>Returned: ${JSON.stringify(result)}`;
          outputDiv.innerHTML = output;
        }
        return result;
      },
    },
  ];
  async function initializeTaskyon(tools) {
    const taskyon = document.getElementById('taskyon');
    if (
      taskyon !== null &&
      taskyon.tagName === 'IFRAME' &&
      taskyon.contentWindow !== null
    ) {
      const iframeTarget = new URL(taskyon.src).origin;
      function waitForTaskyonReady() {
        return new Promise((resolve /*reject*/) => {
          const handleMessage = function (event) {
            const eventOrigin = new URL(event.origin).origin;
            if (
              eventOrigin === iframeTarget &&
              event.data.type === 'taskyonReady'
            ) {
              window.removeEventListener('message', handleMessage);
              console.log('Received message that taskyon is ready!', event);
              resolve(event);
            }
          };
          console.log('waiting for taskyon to be ready....');
          window.addEventListener('message', handleMessage);
        });
      }
      // Send function definition to the taskyon so that the taskyon is aware of it.
      function sendFunctionToTaskyon(toolDescription) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { function: _toolfunc, ...fdescr } = toolDescription;
        const fdMessage = {
          type: 'functionDescription',
          duplicateTaskName: false,
          ...fdescr,
        };
        taskyon.contentWindow?.postMessage(fdMessage, iframeTarget);
      }
      function setUpToolsListener(tools) {
        window.addEventListener('message', function (event) {
          // Check the origin to ensure security
          if (event.origin !== iframeTarget) {
            console.log('Received message from unauthorized origin');
            return;
          }
          console.log('received message:', event);
          // Handle function call
          const tool = tools[0];
          if (tool && event.data) {
            if (event.data.type === 'functionCall') {
              //if the message comes from taskyon, we can be sure that its the correct type.
              const data = event.data;
              const result = tool.function(data.arguments);
              // Send response to iframe
              const response = {
                type: 'functionResponse',
                functionName: tool.id,
                response: result,
              };
              taskyon.contentWindow?.postMessage(response, iframeTarget);
            }
          }
        });
      }
      await waitForTaskyonReady();
      console.log('sending our function!');
      sendFunctionToTaskyon(tools[0]);
      console.log('set up function listener!');
      setUpToolsListener(tools);
    }
  }
  void initializeTaskyon(tools);
});
