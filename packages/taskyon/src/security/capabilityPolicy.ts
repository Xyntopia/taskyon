import type { ToolIdentity } from '../types/tools'
import type { FetchCapability } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { validateSandboxFetchUrl } from '@taskyon/common/modules/webFetching/mediatedFetch'

export type PopupCapability = {
  action: 'popup'
  target: 'custom-html' | `origin:${string}`
}

export type ToolCapability = FetchCapability | PopupCapability
export type CapabilityDecision = 'allow' | 'deny'
export type CapabilityScope = 'once' | 'session' | 'permanent' | 'session-all-public-read'

export type CapabilityRequest = {
  tool: ToolIdentity
  capability: ToolCapability
}

export type CapabilityPrompt = (
  request: CapabilityRequest,
) => Promise<{ decision: CapabilityDecision; scope: CapabilityScope }>

export type CapabilityDecisionStore = {
  get: (key: string) => Promise<CapabilityDecision | null>
  set: (key: string, decision: CapabilityDecision) => Promise<void>
  delete: (key: string) => Promise<void>
  clear: (prefix: string) => Promise<void>
}

function stableCapabilityKey(request: CapabilityRequest) {
  const capability = Object.entries(request.capability)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return `${request.tool.revision}/${capability}`
}

const publicReadToolKey = (request: CapabilityRequest): string | undefined => {
  if (request.capability.action !== 'fetch' || request.capability.access !== 'read')
    return undefined
  try {
    const url = validateSandboxFetchUrl(request.capability.origin)
    if (url.origin !== request.capability.origin) return undefined
  } catch {
    return undefined
  }
  return JSON.stringify([request.tool.publisherId, request.tool.name, request.tool.revision])
}

export function createCapabilityPolicy(options: {
  storage: CapabilityDecisionStore
  prompt?: CapabilityPrompt
  defaults?: (request: CapabilityRequest) => CapabilityDecision | undefined
}) {
  const session = new Map<string, CapabilityDecision>()
  const sessionPublicRead = new Set<string>()
  const prefix = 'security/capabilities/'

  return {
    authorize: async (request: CapabilityRequest): Promise<boolean> => {
      const key = stableCapabilityKey(request)
      const sessionDecision = session.get(key)
      if (sessionDecision) return sessionDecision === 'allow'

      const stored = await options.storage.get(`${prefix}${key}`)
      if (stored) return stored === 'allow'

      const defaultDecision = options.defaults?.(request)
      if (defaultDecision) return defaultDecision === 'allow'
      const publicReadKey = publicReadToolKey(request)
      if (publicReadKey && sessionPublicRead.has(publicReadKey)) return true
      if (!options.prompt) return false

      const result = await options.prompt(request)
      if (result.scope === 'session-all-public-read') {
        if (result.decision !== 'allow' || !publicReadKey) return false
        sessionPublicRead.add(publicReadKey)
        return true
      }
      if (result.scope === 'permanent') {
        await options.storage.set(`${prefix}${key}`, result.decision)
      } else if (result.scope === 'session') {
        session.set(key, result.decision)
      }
      return result.decision === 'allow'
    },
    revoke: async (request: CapabilityRequest): Promise<void> => {
      const key = stableCapabilityKey(request)
      session.delete(key)
      const publicReadKey = publicReadToolKey(request)
      if (publicReadKey) sessionPublicRead.delete(publicReadKey)
      await options.storage.delete(`${prefix}${key}`)
    },
    reset: async (): Promise<void> => {
      session.clear()
      sessionPublicRead.clear()
      await options.storage.clear(prefix)
    },
    clearSession: () => {
      session.clear()
      sessionPublicRead.clear()
    },
  }
}
