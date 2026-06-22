import z from 'zod'
import { executeCodeInIframeSimple } from '../modules/sandbox/iframeWorker'
import { createNode } from './dagCore'

export type DynamicJsNodeDefinition = {
  id: string
  label: string
  version: number
  code: string
  input: Record<string, unknown>
  timeoutMs: number
}

export const defaultDynamicJsCode = `(input) => {
  return input
}`

export const dynamicJsNodeInputSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
})

export const dynamicJsNodeOutputSchema = z.object({
  value: z.unknown(),
})

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => {
    controller.abort(`Dynamic node timed out after ${timeoutMs}ms`)
  }, timeoutMs)

  return {
    signal: controller.signal,
    dispose: () => window.clearTimeout(timeout),
  }
}

export const createDynamicJsNode = (definition: DynamicJsNodeDefinition) =>
  createNode({
    name: definition.id,
    version: definition.version,
    localParams: dynamicJsNodeInputSchema,
    outputSchema: dynamicJsNodeOutputSchema,
    policy: {
      cache: 'ReadWrite',
      scope: 'ModelState',
    },
    run: async (params) => {
      if (typeof document === 'undefined') {
        throw new Error('Dynamic JS nodes require a browser document for iframe execution.')
      }

      const timeoutMs = Math.max(100, Math.min(definition.timeoutMs, 60_000))
      const timeout = createTimeoutSignal(timeoutMs)
      try {
        const value = await executeCodeInIframeSimple(
          {
            id: `dynamic-node-${definition.id}`,
            code: definition.code,
            sourceURL: `${definition.id}.dynamic.js`,
            stopSignal: timeout.signal,
          },
          params.input,
        )
        return { value }
      } finally {
        timeout.dispose()
      }
    },
  })
