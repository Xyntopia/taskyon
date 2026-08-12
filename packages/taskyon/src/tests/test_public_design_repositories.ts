import {
  createUrlDesignRepositoryReader,
  loadDesignRepositorySnapshot,
  type DesignRepositoryTextReader,
} from '@taskyon/comp-dag/designRepositorySnapshot'

const repositories = {
  'ai-workstation': 5,
  backpack: 7,
  'home-battery': 4,
  'mars-rover': 4,
  'mission-drone': 4,
  satellite: 4,
} as const

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const repositoryReader = (projectId: string): DesignRepositoryTextReader => {
  if (typeof window !== 'undefined') {
    return createUrlDesignRepositoryReader({
      baseUrl: new URL(`/design-repositories/${projectId}/`, location.origin),
      fetch,
    })
  }
  return async (path) => {
    const { readFile } = await import('node:fs/promises')
    const baseUrl = new URL(`../../../../public/design-repositories/${projectId}/`, import.meta.url)
    return await readFile(new URL(path, baseUrl), 'utf8')
  }
}

export const testPublicDesignRepositoriesLoadImmutableRootClosures = async () => {
  const loaded = await Promise.all(
    Object.entries(repositories).map(async ([projectId, expectedNodes]) => {
      const snapshot = await loadDesignRepositorySnapshot({
        readText: repositoryReader(projectId),
        checkout: { kind: 'ref', name: 'graph/main' },
      })
      assert(snapshot.revision.nodes.main, `${projectId} must define a main root`)
      assert(
        snapshot.files.length === expectedNodes,
        `${projectId} should load ${expectedNodes} reachable nodes, got ${snapshot.files.length}`,
      )
      return {
        projectId,
        revisionId: snapshot.revision.id,
        rootHash: snapshot.revision.nodes.main,
        nodes: snapshot.files.length,
      }
    }),
  )
  return { repositories: loaded }
}

testPublicDesignRepositoriesLoadImmutableRootClosures.description =
  'Resolves every bundled design ref and verifies its public, hash-addressed node closure.'
