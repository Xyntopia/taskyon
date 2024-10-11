import type { Tool, WorkerMessage } from '../taskyon/tools';

// Function to execute JavaScript in a dynamically created Web Worker
export function executeInDynamicWorker(
  javascriptCode: string,
  workerName: string = 'js-worker',
) {
  return new Promise((resolve, reject) => {
    const workerCode = `
onmessage = function(e) {
  const scopedExecution = (code) => {
    const logMessages = [];
    const console = {
      log: (...args) => {
        logMessages.push(args.join(' '));
      },
    };

    try {
      const result = eval(code);
      return {
        result: result ? result : undefined,
        'console.log': logMessages,
      };
    } catch (e) {
      throw e;
    }
  };

  try {
    const result = scopedExecution(e.data);
    postMessage({ success: true, result });
  } catch (error) {
    postMessage({ success: false, error: error.toString() });
  }
};

//# sourceURL=js-worker.js
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl, { name: workerName }); // Specify the worker name here

    worker.onmessage = function (e: MessageEvent<WorkerMessage>) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      worker.terminate(); // Terminate the worker after receiving the message
      if (e.data.success) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
    };

    worker.onerror = function (error) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      worker.terminate(); // Terminate the worker on error
      reject(new Error(`Worker error: ${error.message}`));
    };

    worker.postMessage(javascriptCode);
  });
}

// Tool to Execute JavaScript Code
export const executeJavaScript: Tool = {
  function: async ({ code, useWebWorker = false }) => {
    if (!(typeof code === 'string'))
      throw Error('Can not read provided code', code);
    if (code.length == 0) throw Error('Provided code is empty!');
    console.log('Executing JavaScript code...');
    if (useWebWorker) {
      // Execute using a dynamically created Web Worker
      return executeInDynamicWorker(code);
    } else {
      // Execute in the main thread
      try {
        // Create a scoped environment for execution
        const scopedExecution = () => {
          const logMessages: string[] = [];
          // Override console.log within this function's scope
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const console = {
            log: (...args: unknown[]) => {
              logMessages.push(args.join(' '));
            },
          };

          try {
            // Execute the JavaScript code
            const result = eval(code) as unknown;
            return {
              result: result ? result : undefined,
              'console.log': logMessages,
            };
          } catch (e) {
            throw e;
          }
        };

        // Execute the scoped function and capture the result
        const executionResult = scopedExecution();

        console.log('finished js execution..');

        return executionResult;
      } catch (error) {
        return Promise.reject(error);
      }
    }
  },
  description: 'Runs JavaScript code',
  longDescription: `Runs JavaScript code either in the main thread or using a Web Worker, useful
for tasks requiring DOM manipulation, data processing, or dynamic web content generation.`,
  name: 'executeJavaScript',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to be executed.',
      },
      useWebWorker: {
        type: 'boolean',
        description:
          'Whether to execute the code in a Web Worker or main thread.',
        default: false,
      },
    },
    required: ['code'],
  },
};
