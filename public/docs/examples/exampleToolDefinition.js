const outputDiv = document.getElementById('output');

const configuration = {
  model: 'llama-3',
  verificationcode: '2o8zbackwughbck73tqbc3r',
};

const tools = [
  {
    description: {
      // this is important!, Taskyon can be configured to prevent tasks from getting created if they already exist with the same name!
      // this helps in making sure, that tasks & tools which we upload to taskyon on pageload don't get duplicated
      // on every pageload.
      // If that option is turned on, we can use this as a version string for our tasks... And every time we want
      // to update our webpage with a new AI tool, we simply change the version string...
      name: 'simpleExampleTask.V1',
      content: {
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
              description:
                'This is another example parameter, but not required!',
            },
          },
          required: ['parameter1'],
        },
      },
    },
    function: (data) => {
      console.log('Received function call with data:', data);
      const result = `${data.parameter1}${data.parameter2}`;
      return result;
    },
  },
];

async function initializeTaskyon(tools) {
  const iframeTarget = 'http://localhost:8080';

  function waitForTaskyonReady() {
    return new Promise((resolve, reject) => {
      const handleMessage = function (event) {
        console.log('received event:', event);
        if (
          event.origin === iframeTarget &&
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
    var taskyon = document.getElementById('taskyon');
    taskyon.contentWindow.postMessage(
      {
        type: 'task',
        task: {
          role: 'system',
          label: ['function'],
          ...toolDescription,
        },
        execute: false,
        duplicateTaskName: false, // we use this here in order to prevent duplicate creation of our function declaration task
      },
      iframeTarget
    );
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
      if (event.data.type === 'functionCall') {
        //if the message comes from taskyon, we can be sure that its the correct type.
        const data = event.data;
        const result = tool.function(data.arguments);

        // Display function call information
        const output = `Function called with parameters: ${JSON.stringify(
          data
        )}<br>Returned: ${result}`;
        outputDiv.innerHTML = output;

        // Send response to iframe
        const response = {
          type: 'functionResponse',
          functionName: tool.description.content.name,
          response: result,
        };
        taskyon.contentWindow.postMessage(response, iframeTarget);
      }
    });
  }

  await waitForTaskyonReady();
  console.log('sending our function!');
  sendFunctionToTaskyon(tools[0].description);
  console.log('set up function listener!');
  setUpToolsListener(tools);
}

initializeTaskyon(tools);
