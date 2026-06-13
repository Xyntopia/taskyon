import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxRpcHandlers,
} from '@taskyon/shared/modules/sandbox/workerSandbox'
import { executeInWorkerSandbox } from '@taskyon/shared/modules/sandbox/workerSandbox'
import type { toolContext } from '../types/toolApi'
import { taskMarker } from '../types/tools'

function buildToolSandboxCode(userCode: string): string {
  return `
    (function () {
      const userFn = ${userCode};

      const callRpc = (rpcType, ...args) => {
        const rpc = globalThis.__workerSandboxRpc;
        if (typeof rpc !== 'function') {
          throw new Error('Worker sandbox RPC bridge is not available');
        }
        return rpc(rpcType, ...args);
      };

      function toolCall(f) {
        return {
          role: 'function',
          name: f.name,
          content: {
            type: 'functioncall',
            data: f,
          },
        };
      }

      function makeTaskResult(tasks) {
        return {
          taskResultMarker: "${taskMarker}",
          taskChainList: tasks,
        };
      }

      function createChatCompletionTask(args) {
        return {
          role: 'function',
          content: {
            type: 'functioncall',
            data: {
              name: 'chatCompletion',
              arguments: args ?? {},
            },
          },
        };
      }

      return async function (params, baseContext) {
        const ctx = {
          ...(baseContext || {}),
          getSecret: (...args) => callRpc('getSecret', ...args),
          setSecret: (...args) => callRpc('setSecret', ...args),
          messagePort: globalThis.__workerSandboxMessagePort ?? null,
          toolCall,
          makeTaskResult,
          createChatCompletionTask,
        };
        return userFn(params, ctx);
      };
    })()
  `
}

function buildRpcHandlers(context: toolContext): WorkerSandboxRpcHandlers {
  return {
    getSecret: (name, askNew, saveNew) =>
      context.getSecret(
        String(name),
        typeof askNew === 'string' || typeof askNew === 'boolean' ? askNew : false,
        typeof saveNew === 'boolean' ? saveNew : undefined,
      ),
    setSecret: (name, value) => context.setSecret(String(name), String(value)),
  }
}

export function executeToolInWorkerSandbox(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'worker-sandbox-tool.js',
  stopSignal: AbortSignal,
): Promise<unknown> {
  const { toolId, taskChain, messagePort } = args.context
  const options: ExecuteInWorkerSandboxOptions = {
    id: toolId,
    code: buildToolSandboxCode(code),
    sourceURL,
    stopSignal,
    rpcHandlers: buildRpcHandlers(args.context),
    messagePort,
  }

  return executeInWorkerSandbox(options, args.params, { taskChain, toolId })
}
