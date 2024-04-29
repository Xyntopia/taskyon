const iframeTarget = 'http://localhost:8080';
const outputDiv = document.getElementById('output');

const functionTask = {
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
};

// Function to be called from the iframe
function myTaskyonFunction(data) {
  console.log('Received function call with data:', data);
  const result = `You sent: ${data.parameter1} and ${data.parameter2}`;
  return result;
}

// Send function definition to the iframe
var taskyon = document.getElementById('taskyon');
taskyon.addEventListener('load', function () {
  console.log('sending our function!')
  taskyon.contentWindow.postMessage({ task: functionTask }, iframeTarget);
});

window.addEventListener('message', function (event) {
  // Check the origin to ensure security
  if (event.origin !== iframeTarget) {
    console.log('Received message from unauthorized origin');
    return;
  }

  console.log('received message:', event);
  // Handle function call
  if (event.data.type === 'callFunction') {
    const data = event.data;
    const result = myTaskyonFunction(data);
    taskyon.contentWindow.postMessage({ result }, iframeTarget);

    // Display function call information
    const output = `Function called with parameters: ${JSON.stringify(
      data
    )}<br>Returned: ${result}`;
    outputDiv.innerHTML = output;
  }
});
