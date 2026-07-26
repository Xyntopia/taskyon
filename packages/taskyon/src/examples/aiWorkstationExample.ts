import type { Hash } from '@taskyon/comp-dag/caching'
import {
  createUrlDesignRepositoryReader,
  loadDesignRepositorySnapshot,
  type DesignRepositoryTextReader,
  type LoadedDesignRepositorySnapshot,
} from '@taskyon/comp-dag/designRepositorySnapshot'

export const AI_WORKSTATION_REPOSITORY_PATH = '/design-repositories/ai-workstation/'

export type AiWorkstationExample = LoadedDesignRepositorySnapshot & {
  nodes: LoadedDesignRepositorySnapshot['nodesByHash'][Hash][]
  rootHash: Hash
}

const browserRepositoryReader = (): DesignRepositoryTextReader => {
  if (typeof location === 'undefined' || typeof fetch === 'undefined') {
    throw new Error('A design repository reader is required outside the browser.')
  }
  return createUrlDesignRepositoryReader({
    baseUrl: new URL(AI_WORKSTATION_REPOSITORY_PATH, location.origin),
    fetch,
  })
}

export const createAiWorkstationExample = async (options?: {
  readText?: DesignRepositoryTextReader
}): Promise<AiWorkstationExample> => {
  const snapshot = await loadDesignRepositorySnapshot({
    readText: options?.readText ?? browserRepositoryReader(),
    checkout: { kind: 'ref', name: 'main' },
  })
  const root = snapshot.revision.roots.main
  if (!root) throw new Error('AI workstation repository revision has no main root.')
  return {
    ...snapshot,
    nodes: Object.values(snapshot.nodesByHash),
    rootHash: root.nodeId,
  }
}
