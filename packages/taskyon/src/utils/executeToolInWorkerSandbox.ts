import {
  createSandboxProtocolClient,
  serveFrpSandboxCapability,
} from '@taskyon/common/modules/sandbox/frpSandbox'
import { createExecutableSandbox } from '@taskyon/common/modules/sandbox/workerSandbox'
import type { ProtocolServerHandlers } from '@taskyon/common/modules/frpBus'
import { toolContextProtocol } from '../core/toolContextProtocol.ts'
import { loadSandboxAsset } from '../sandbox/sandboxAssets'
import type { toolContext } from '../types/toolApi'
import { partialTaskDraft } from '../types/taskNode'

function buildToolSandboxCode(userCode: string): string {
  const createProtocolClientSource = createSandboxProtocolClient.toString()
  return `
    (function () {
      const userFn = ${userCode};
      const createProtocolClient = ${createProtocolClientSource};

      function toolCall(f) {
        return {
          role: 'function',
          name: f.name,
          content: { type: 'functioncall', data: f },
        };
      }

      function createChatCompletionTask(args) {
        return {
          role: 'function',
          content: {
            type: 'functioncall',
            data: { name: 'chatCompletion', arguments: args ?? {} },
          },
        };
      }

      function normalizeHeaders(headers) {
        if (!headers) return undefined;
        if (Array.isArray(headers)) return headers.map(([key, value]) => [String(key), String(value)]);
        if (typeof headers.entries === 'function') return Array.from(headers.entries());
        return Object.entries(headers).map(([key, value]) => [key, String(value)]);
      }

      function decodeBase64(value) {
        if (typeof atob !== 'function') {
          throw new Error('Binary sandbox responses are unavailable in this runtime');
        }
        const binary = atob(value);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
      }

      class SandboxHeaders {
        constructor(entries) {
          this.entriesValue = entries.map(([key, value]) => [key.toLowerCase(), value]);
        }
        get(name) {
          return this.entriesValue.find(([key]) => key === String(name).toLowerCase())?.[1] ?? null;
        }
        entries() { return this.entriesValue.values(); }
        forEach(callback) { this.entriesValue.forEach(([key, value]) => callback(value, key, this)); }
        [Symbol.iterator]() { return this.entries(); }
      }

      class SandboxResponse {
        constructor(response) {
          this.status = response.status;
          this.statusText = response.statusText;
          this.headers = new SandboxHeaders(response.headers);
          this.ok = this.status >= 200 && this.status < 300;
          this.bodyValue = response.body;
          this.bodyBase64 = response.bodyBase64;
        }
        async arrayBuffer() {
          if (this.bodyBase64) {
            const bytes = decodeBase64(this.bodyBase64);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
          return new TextEncoder().encode(this.bodyValue ?? '').buffer;
        }
        async text() {
          if (!this.bodyBase64) return this.bodyValue ?? '';
          return new TextDecoder().decode(decodeBase64(this.bodyBase64));
        }
        async json() { return JSON.parse(await this.text()); }
      }

      let activeFetch;
      let executionQueue = Promise.resolve();
      const globalFetch = (...args) => {
        if (!activeFetch) throw new Error('Sandbox fetch is unavailable outside tool execution');
        return activeFetch(...args);
      };
      Object.defineProperty(globalThis, 'fetch', {
        configurable: false,
        enumerable: true,
        writable: false,
        value: globalFetch,
      });

      return function (params, baseContext, sandboxApi) {
        const execute = async () => {
          if (!sandboxApi.port) throw new Error('Tool context protocol port is unavailable');
          const protocol = createProtocolClient(sandboxApi.port, 'toolContext', sandboxApi.signal);
          const call = (command, payload = {}) => protocol.call(command, payload);
          const sandboxFetch = async (input, init = {}) => {
            const url = input && typeof input === 'object' && 'url' in input
              ? String(input.url)
              : String(input);
            const requestInit = {
              ...(init.method === undefined ? {} : { method: String(init.method) }),
              ...(init.headers === undefined ? {} : { headers: normalizeHeaders(init.headers) }),
              ...(init.body === undefined ? {} : { body: String(init.body) }),
            };
            return new SandboxResponse(await call('fetch', { input: url, init: requestInit }));
          };
          const ctx = {
            ...(baseContext || {}),
            stopSignal: sandboxApi.signal,
            getSecret: (name, askNew, saveNew) => call('getSecret', {
              name,
              askNew,
              ...(saveNew === undefined ? {} : { saveNew }),
            }),
            setSecret: (name, value) => call('setSecret', { name, value }),
            getExecutionTaskChain: () => call('getExecutionTaskChain'),
            waitForInteraction: (request) => call('waitForInteraction', request || {}),
            toolCall,
            createSubtasksResult: (tasks) => call('createSubtasksResult', { tasks }),
            createChatCompletionTask,
            fetch: sandboxFetch,
          };
          activeFetch = sandboxFetch;
          try {
            return await userFn(params, ctx);
          } finally {
            activeFetch = undefined;
          }
        };
        const result = executionQueue.then(execute, execute);
        executionQueue = result.then(() => undefined, () => undefined);
        return result;
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

function buildContextHandlers(
  context: toolContext,
): ProtocolServerHandlers<typeof toolContextProtocol> {
  return {
    toolContext: {
      getSecret: ({ name, askNew, saveNew }) => context.getSecret(name, askNew, saveNew),
      setSecret: ({ name, value }) => context.setSecret(name, value),
      getExecutionTaskChain: () => context.getExecutionTaskChain(),
      createSubtasksResult: ({ tasks }) =>
        context.createSubtasksResult(parseCreateSubtasksResultInput(tasks)),
      waitForInteraction: ({ tool, token }) => {
        if (!context.waitForInteraction) {
          throw new Error('Tool interaction capability is unavailable.')
        }
        return context.waitForInteraction({
          ...(tool === undefined ? {} : { tool }),
          ...(token === undefined ? {} : { token }),
        })
      },
      fetch: async ({ input, init }) => {
        const assetBodyBase64 = await loadSandboxAsset(input)
        if (assetBodyBase64 !== null) {
          return {
            status: 200,
            statusText: 'OK',
            headers: [
              [
                'content-type',
                input.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
              ],
            ] as [string, string][],
            bodyBase64: assetBodyBase64,
          }
        }
        if (!context.fetch) throw new Error('Sandbox fetch capability is unavailable')
        const response = await context.fetch(input, {
          ...(init?.method ? { method: init.method } : {}),
          ...(init?.headers ? { headers: init.headers } : {}),
          ...(init?.body ? { body: init.body } : {}),
        })
        const headers: [string, string][] = []
        response.headers.forEach((value, key) => headers.push([key, value]))
        return {
          status: response.status,
          statusText: response.statusText,
          headers,
          body: await response.text(),
        }
      },
    },
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

export async function executeToolInWorkerSandbox(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'worker-sandbox-tool.js',
  stopSignal: AbortSignal,
): Promise<unknown> {
  if (shouldExecuteToolInMainThread()) return await executeToolInMainThread(code, args, sourceURL)

  const { toolId } = args.context
  const sandbox = await createExecutableSandbox({
    id: toolId,
    reuse: { mode: 'immutable', contentId: toolId },
  })
  await sandbox.installModule(toolId, buildToolSandboxCode(code), sourceURL)
  const capability = await serveFrpSandboxCapability({
    sandbox,
    protocol: toolContextProtocol,
    handlers: buildContextHandlers(args.context),
    signal: stopSignal,
  })
  try {
    return await sandbox.executeModule(toolId, [args.params, { toolId }], {
      signal: stopSignal,
      sourceURL,
      channel: capability.channel,
    })
  } finally {
    capability.destroy()
  }
}
