// we can compile this file to js using:
// swc --config-file ./swcrc exampleToolDefinition.ts -o exampleToolDefinition.js

export type Tool = Record<string, unknown> & {
  function: (...args: unknown[]) => unknown;
  name: string;
};

export async function initializeTaskyon(
  tools: Tool[],
  configuration: Record<string, unknown>,
) {
  const taskyon = document.getElementById('taskyon') as HTMLIFrameElement;

  if (
    taskyon !== null &&
    taskyon.tagName === 'IFRAME' &&
    taskyon.contentWindow !== null
  ) {
    const iframeTarget = new URL(taskyon.src).origin;

    function waitForTaskyonReady() {
      return new Promise((resolve /*reject*/) => {
        const handleMessage = function (event: MessageEvent<{ type: string }>) {
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
    function sendConfigurationToTaskyon(configuration: unknown) {
      const message = {
        type: 'configurationMessage',
        conf: configuration,
      };
      taskyon.contentWindow?.postMessage(message, iframeTarget);
    }

    // Send function definition to the taskyon so that the taskyon is aware of it.
    function sendFunctionToTaskyon(toolDescription: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { function: _toolfunc, ...fdescr } = toolDescription;
      const fdMessage = {
        type: 'functionDescription',
        duplicateTaskName: false, // we use this here in order to prevent duplicate creation of our function declaration task
        ...fdescr,
      };
      taskyon.contentWindow?.postMessage(fdMessage, iframeTarget);
    }

    function setUpToolsListener(tools: Tool[]) {
      window.addEventListener(
        'message',
        function (event: MessageEvent<{ type: string; arguments: unknown }>) {
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
                functionName: tool.name,
                response: result,
              };
              taskyon.contentWindow?.postMessage(response, iframeTarget);
            }
          }
        },
      );
    }

    await waitForTaskyonReady();
    console.log('send our configuration!');
    sendConfigurationToTaskyon(configuration);
    tools.forEach((t) => {
      console.log('sending our functions!');
      sendFunctionToTaskyon(t);
      console.log('set up function listener!');
      setUpToolsListener(tools);
    });
  }
}

void initializeTaskyon(tools, configuration);
