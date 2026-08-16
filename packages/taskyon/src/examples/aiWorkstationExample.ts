import type { Hash } from '@taskyon/comp-dag/caching'
import {
  compileDesignRepositoryNodes,
  createUrlDesignRepositoryReader,
  loadProjectRepositorySnapshot,
  type DesignRepositoryTextReader,
  type LoadedProjectRepositorySnapshot,
} from '@taskyon/comp-dag/designRepositorySnapshot'

export const AI_WORKSTATION_REPOSITORY_PATH = '/design-repositories/ai-workstation/'

export type AiWorkstationExample = LoadedProjectRepositorySnapshot & {
  nodes: LoadedProjectRepositorySnapshot['nodesByHash'][Hash][]
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
  const snapshot = await loadProjectRepositorySnapshot({
    readText: options?.readText ?? browserRepositoryReader(),
    checkout: { kind: 'ref', name: 'projects/template' },
  })
  const invocationId = snapshot.revision.invocations.main
  const invocation = invocationId ? snapshot.invocations[invocationId] : undefined
  if (!invocation) throw new Error('AI workstation project has no main invocation.')
  const nodesByHash = await compileDesignRepositoryNodes(snapshot)
  return {
    ...snapshot,
    nodesByHash,
    nodes: Object.values(nodesByHash),
    rootHash: invocation.rootNodeId,
  }
}
