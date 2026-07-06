import { executeInWorkerSandbox } from '@taskyon/common/modules/sandbox/workerSandbox'
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

export const dynamicJsNodeInputSchema = {
  type: 'object',
  properties: {
    input: {
      type: 'object',
      additionalProperties: true,
      default: {},
    },
  },
  required: ['input'],
  additionalProperties: false,
} as const

export const dynamicJsNodeOutputSchema = {
  type: 'object',
  properties: {
    value: {},
  },
  required: ['value'],
  additionalProperties: false,
} as const

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
  createNode<
    typeof dynamicJsNodeInputSchema,
    typeof dynamicJsNodeOutputSchema,
    Record<never, never>,
    Record<never, never>,
    { input: Record<string, unknown> },
    { value: unknown }
  >({
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
        const value = await executeInWorkerSandbox(
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
