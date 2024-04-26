import type { Tool, WorkerMessage } from '../taskyon/tools';

// Function to execute JavaScript in a dynamically created Web Worker
export function executeInDynamicWorker(javascriptCode: string) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      onmessage = function(e) {
        try {
          const result = eval(e.data);
          postMessage({ success: true, result });
        } catch (error) {
          postMessage({ success: false, error: error.toString() });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = function (e: MessageEvent<WorkerMessage>) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      if (e.data.success) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
    };

    worker.onerror = function (error) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      reject(new Error(`Worker error: ${error.message}`));
    };

    worker.postMessage(javascriptCode);
  });
}

// Tool to Execute JavaScript Code
export const executeJavaScript: Tool = {
  function: async ({ javascriptCode, useWorker = false }) => {
    console.log('Executing JavaScript code...');
    if (useWorker) {
      // Execute using a dynamically created Web Worker
      return executeInDynamicWorker(javascriptCode);
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
            const result = eval(javascriptCode) as unknown;
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
  description: `Runs JavaScript code either in the main thread or using a Web Worker, useful
for tasks requiring DOM manipulation, data processing, or dynamic web content generation.`,
  name: 'executeJavaScript',
  parameters: {
    type: 'object',
    properties: {
      javascriptCode: {
        type: 'string',
        description: 'The JavaScript code to be executed.',
      },
      useWebWorker: {
        type: 'boolean',
        description: `Whether to execute the code in a Web Worker or main thread.
If the javascript code is executed in the main thread, it can manipulate
the DOM where it is currently running.`,
        default: false,
      },
    },
    required: ['javascriptCode'],
  },
};
