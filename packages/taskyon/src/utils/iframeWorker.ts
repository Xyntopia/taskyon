import z from 'zod'
import { sleep } from './asyncUtils'
import type { toolContext } from '../types/toolApi'
import { taskMarker } from '../types/tools'
import { createSandboxedIframe, iframes, interruptExecution } from '../iframeruntime/iframeWorker'

// Small helper for JSON-based deep cloning to keep payloads structured-clone-safe
const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// 1) Define schemas for the two message “shapes”
const rpcMessageSchema = z.object({
  type: z.string(),
  args: z.array(z.unknown()).optional(),
})
const finalMessageSchema = z.object({
  result: z.unknown().optional(),
  error: z.string().optional(),
})
const portMessageSchema = z.union([rpcMessageSchema, finalMessageSchema])

// ---------- CORE EXECUTION PRIMITIVE ----------

interface ExecuteInIframeCoreOptions<R> {
  id: string
  code: string
  params: unknown[]
  sourceURL?: string
  stopSignal: AbortSignal
  preparePayload: (input: { code: string; params: unknown[]; sourceURL: string }) => {
    payload: unknown
    transfer: Transferable[]
  }
  handleMessage: (input: {
    event: MessageEvent
    port: MessagePort
    resolve: (value: R) => void
    reject: (reason: unknown) => void
  }) => void | Promise<void>
}

/**
 * Core, reusable iframe execution function.
 * All DOM / Map side-effects are contained here; message semantics are injected via hooks.
 */
async function executeInIframeCore<R = unknown>(
  options: ExecuteInIframeCoreOptions<R>,
): Promise<R> {
  const { id, code, params, stopSignal, preparePayload, handleMessage } = options
  const sourceURL = options.sourceURL ?? 'sandboxed-code.js'

  let iframeEntry = iframes.get(id)
  // Lazy initialize iframe + control port
  if (!iframeEntry) {
    iframeEntry = await createSandboxedIframe(id)
    // Add a delay to ensure iframe is fully ready. Its ok, because we normally do this only once here...
    await sleep(100)
  }

  const { port } = iframeEntry

  return new Promise<R>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      Promise.resolve(
        handleMessage({
          event,
          port,
          resolve,
          reject,
        }),
      ).catch(reject)
    }

    // Wire up the handler for this execution.
    // Assumption: only one active execution per iframe/id at a time.
    port.onmessage = onMessage
    port.start()

    const { payload, transfer } = preparePayload({ code, params, sourceURL })

    // Send the work request to the iframe
    port.postMessage(payload, transfer)

    const onAbort = () => {
      console.log('Interrupting iframe execution for', id)
      interruptExecution(id)
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    }

    if (stopSignal.aborted) {
      onAbort()
      return
    }

    stopSignal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------- SIMPLE PUBLIC API ----------

interface ExecuteCodeInIframeSimpleOptions {
  id: string
  code: string // user function as a string: e.g. `(a, b, ctx) => { ... }`
  sourceURL?: string
  stopSignal: AbortSignal
}

/**
 * Simple iframe executor:
 *  - caller provides `id` manually
 *  - no toolContext, no RPC handling, no extra ports
 *  - accepts a variadic list of arguments, passed *positionally* to the user function.
 *
 * Example:
 *   const code = `(a, b, ctx, c) => { ... }`
 *   const result = await executeCodeInIframeSimple(
 *     { id: 'my-id', code, sourceURL: 'my-src.js', stopSignal },
 *     1, 2, { some: 'context' }, 3,
 *   )
 *
 * Inside the iframe:
 *   params === [1, 2, { some: 'context' }, 3]
 *   userFn(...params) is called, so a=1, b=2, ctx={...}, c=3
 */
export function executeCodeInIframeSimple<R = unknown>(
  options: ExecuteCodeInIframeSimpleOptions,
  ...args: unknown[]
): Promise<R> {
  const { id, code, sourceURL = 'sandboxed-code.js', stopSignal } = options

  return executeInIframeCore<R>({
    id,
    code,
    params: args, // positional arguments for userFn(...params) in the iframe
    sourceURL,
    stopSignal,
    preparePayload: ({ code, params, sourceURL }) => {
      const payload = deepClone({
        code,
        params,
        sourceURL,
      })
      const transfer: Transferable[] = []
      return { payload, transfer }
    },
    handleMessage: ({ event, port, resolve, reject }) => {
      const msg = finalMessageSchema.parse(event.data)
      // Keep the control port open for future executions, just detach the handler
      port.onmessage = null
      if (msg.error) {
        reject(new Error(msg.error))
      } else {
        resolve(msg.result as R)
      }
    },
  })
}

// ---------- TOOL-AWARE PUBLIC API (ORIGINAL BEHAVIOR) ----------

/**
 * Tool-aware executor: same external semantics as the original `executeCodeInIframe`.
 * Internally, it:
 *  - wraps the user function with tool/RPC helpers
 *  - calls the minimal iframe runner via `executeInIframeCore`
 */
export function executeCodeInIframe(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
) {
  const rpcs = ['getSecret', 'setSecret'] as const

  const { toolId, taskChain, messagePort } = args.context

  // Base context that is clone-safe (no ports, no functions)
  const baseContext = { taskChain, toolId }

  // Wrap user code with tool/RPC/context functionality.
  // The final function signature in the iframe is:
  //   (params, baseContext) => userFn(params, ctx)
  // where ctx = { ...baseContext, ...rpcContext, messagePort }
  const wrappedCode = `
    (function () {
      const userFn = ${code};

      const makeChannelInvoker = (reqType) => (...fnArgs) => {
        const chan = new MessageChannel();
        return new Promise((resolve, reject) => {
          chan.port1.onmessage = (e) => {
            const msg = e.data;
            if (msg && msg.type === 'error') {
              reject(new Error(msg.error || 'Unknown RPC error'));
            } else if (msg && msg.type === 'result') {
              resolve(msg.value);
            } else {
              reject(new Error('Unexpected RPC response: ' + JSON.stringify(msg)));
            }
            chan.port1.close();
          };
          if (!window.__taskyonControlPort) {
            reject(new Error('RPC control port not available'));
            return;
          }
          window.__taskyonControlPort.postMessage(
            { type: reqType, args: fnArgs },
            [chan.port2]
          );
        });
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

      const rpcContext = {
        getSecret: makeChannelInvoker('getSecret'),
        setSecret: makeChannelInvoker('setSecret'),
      };

      return async function (params, baseContext) {
        const ctx = {
          ...(baseContext || {}),
          ...rpcContext,
          // messagePort is provided via the extra transferable port and exposed by the runner
          messagePort: window.__taskyonMessagePort || null,
          toolCall,
          makeTaskResult,
          createChatCompletionTask,
        };
        return userFn(params, ctx);
      };
    })()
  `

  return executeInIframeCore<unknown>({
    id: toolId,
    code: wrappedCode,
    // The runner will call userFn(...params) where:
    //   params[0] === original params
    //   params[1] === baseContext
    params: [args.params, baseContext],
    sourceURL,
    stopSignal,
    preparePayload: ({ code, params, sourceURL }) => {
      const payload = deepClone({
        code,
        params,
        sourceURL,
      })

      const transfer: Transferable[] = []
      if (messagePort) {
        transfer.push(messagePort)
      }

      return { payload, transfer }
    },
    handleMessage: async ({ event, port, resolve, reject }) => {
      const msg = portMessageSchema.parse(event.data)

      // RPC calls during iframe task execution
      if ('type' in msg && (rpcs as readonly string[]).includes(msg.type)) {
        const fnName = msg.type as keyof toolContext
        const fn = args.context[fnName] as (..._args: unknown[]) => unknown

        // Use the transferred port for this RPC call
        const rpcPort = event.ports && event.ports[0]
        if (!rpcPort) {
          // Defensive: If no port, send error back on main port
          port.postMessage({
            type: `${msg.type} Error`,
            error: 'No response port provided for RPC',
          })
          return
        }

        if (typeof fn === 'function') {
          try {
            const fnargs = msg.args ?? []
            const res = await fn(...fnargs)
            rpcPort.postMessage({ type: 'result', value: res })
          } catch (err) {
            rpcPort.postMessage({
              type: 'error',
              error: err instanceof Error ? err.message : String(err),
            })
          } finally {
            rpcPort.close()
          }
        } else {
          rpcPort.postMessage({ type: 'error', error: `RPC "${msg.type}" not found` })
          rpcPort.close()
        }
        return
      }

      // Final sandbox result
      if ('result' in msg || 'error' in msg) {
        // We keep the control port open for future executions, just detach the handler
        port.onmessage = null
        if (msg.error) {
          reject(new Error(msg.error))
        } else {
          resolve(msg.result)
        }
      }
    },
  })
}
