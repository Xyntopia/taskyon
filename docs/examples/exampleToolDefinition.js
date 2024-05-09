const outputDiv = document.getElementById('output');

const tools = [
  {
    role: 'system',
    // this is important!, Taskyon can be configured to prevent tasks from getting created if they already exist with the same name!
    // this helps in making sure, that tasks & tools which we upload to taskyon on pageload don't get duplicated
    // on every pageload.
    // If that option is turned on, we can use this as a version string for our tasks... And every time we want
    // to update our webpage with a new AI tool, we simply change the version string...
    name: 'simpleExampleTask.V1',
    content: `{
  "name": "myExampleStringAdderAlone",
  "description": "provide a short description which an AI can understand",
  "longDescription": "provide a long description if the AI/Human needs more details",
  "parameters": {
    "type": "object",
    "properties": {
      "parameter1": {
        "type": "string",
        "description": "This is an example parameter!"
      },
      "parameter2": {
        "type": "string",
        "description": "This is another example parameter, but not required!"
      }
    },
    "required": ["parameter1"]
  }
}`,
    label: ['function'],
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
        if (
          event.origin !== iframeTarget &&
          event.data.type === 'taskyonReady'
        ) {
          console.log('Received message that taskyon is ready!', event);
          clearTimeout(timeoutId);
          window.removeEventListener('message', handleMessage);
          resolve(event);
        }
      };

      window.addEventListener('message', handleMessage);
    });
  }

  // Send function definition to the taskyon so that the taskyon is aware of it.
  function sendFunctionToTaskyon(toolDescription) {
    var taskyon = document.getElementById('taskyon');
    taskyon.contentWindow.postMessage(
      {
        type: 'task',
        task: toolDescription,
        execute: false,
        duplicateTaskName: false, // we use this here in order to prevent duplicate creation of our function declaration task
      },
      iframeTarget
    );
  }

  function setUpToolsListener(Tools) {
    window.addEventListener('message', function (event) {
      // Check the origin to ensure security
      if (event.origin !== iframeTarget) {
        console.log('Received message from unauthorized origin');
        return;
      }

      console.log('received message:', event);
      // Handle function call
      if (event.data.type === 'functionCall') {
        //if the message comes from taskyon, we can be sure that its the correct type.
        const data = event.data;
        const result = myTaskyonFunction(data.arguments);

        // Display function call information
        const output = `Function called with parameters: ${JSON.stringify(
          data
        )}<br>Returned: ${result}`;
        outputDiv.innerHTML = output;

        // Send response to iframe
        const response = {
          type: 'functionResponse',
          functionName: 'myExampleStringAdderAlone',
          response: result,
        };
        taskyon.contentWindow.postMessage(response, iframeTarget);
      }
    });
  }

  await waitForTaskyonReady();
  console.log('sending our function!');
  sendFunctionToTaskyon(tools);
  setUpToolsListener(tools);
}

initializeTaskyon(tools);
