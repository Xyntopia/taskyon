import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxRpcHandlers,
} from '@taskyon/common/modules/sandbox/workerSandbox'
import { executeInWorkerSandbox } from '@taskyon/common/modules/sandbox/workerSandbox'
import { partialTaskDraft } from '../types/taskNode'
import type { toolContext } from '../types/toolApi'

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
          getExecutionTaskChain: () => callRpc('getExecutionTaskChain'),
          messagePort: globalThis.__workerSandboxMessagePort ?? null,
          toolCall,
          createSubtasksResult: (tasks) => callRpc('createSubtasksResult', tasks),
          createChatCompletionTask,
        };
        return userFn(params, ctx);
      };
    })()
  `
}

function parseCreateSubtasksResultInput(
  value: unknown,
): Parameters<toolContext['createSubtasksResult']>[0] {
  const singleTask = partialTaskDraft.safeParse(value)
  if (singleTask.success) return singleTask.data

  const taskChain = partialTaskDraft.array().safeParse(value)
  if (taskChain.success) return taskChain.data

  return partialTaskDraft.array().array().parse(value)
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
    getExecutionTaskChain: () => context.getExecutionTaskChain(),
    createSubtasksResult: (tasks) =>
      context.createSubtasksResult(parseCreateSubtasksResultInput(tasks)),
  }
}

const shouldExecuteToolInMainThread = () =>
  typeof window !== 'undefined' &&
  import.meta.env?.DEV === true &&
  import.meta.env.VITE_TASKYON_TOOL_EXECUTION === 'main-thread'

const executeToolInMainThread = async (
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL: string,
) => {
  console.warn('Executing tool code without a sandbox because development override is enabled.')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const toolFunction: unknown = new Function(
    `return (${code})\n//# sourceURL=${sourceURL.replace(/[\r\n]/g, '')}`,
  )()
  if (typeof toolFunction !== 'function') {
    throw new Error('Tool code did not evaluate to a function')
  }
  return await Reflect.apply(toolFunction, undefined, [args.params, args.context])
}

export function executeToolInWorkerSandbox(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'worker-sandbox-tool.js',
  stopSignal: AbortSignal,
): Promise<unknown> {
  if (shouldExecuteToolInMainThread()) return executeToolInMainThread(code, args, sourceURL)

  const { toolId, messagePort } = args.context
  const options: ExecuteInWorkerSandboxOptions = {
    id: toolId,
    code: buildToolSandboxCode(code),
    sourceURL,
    stopSignal,
    rpcHandlers: buildRpcHandlers(args.context),
    messagePort,
  }

  return executeInWorkerSandbox(options, args.params, { toolId })
}
