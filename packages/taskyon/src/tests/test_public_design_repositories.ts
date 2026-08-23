import {
  createDesignRepositoryFileReader,
  createUrlDesignRepositoryReader,
  loadDesignRepositorySnapshot,
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

const repositoryReader = async (projectId: string) => {
  if (typeof window !== 'undefined') {
    return createUrlDesignRepositoryReader({
      baseUrl: new URL(`/design-repositories/${projectId}/`, location.origin),
      fetch,
    })
  }
  const { readFile } = await import('node:fs/promises')
  const baseUrl = new URL(`../../../../public/design-repositories/${projectId}/`, import.meta.url)
  const paths = JSON.parse(
    await readFile(new URL('repository-index.json', baseUrl), 'utf8'),
  ) as string[]
  const files = await Promise.all(
    paths.map(async (path) => ({ path, content: await readFile(new URL(path, baseUrl), 'utf8') })),
  )
  return createDesignRepositoryFileReader(files).readText
}

export const testPublicDesignRepositoriesLoadImmutableRootClosures = async () => {
  const loaded = await Promise.all(
    Object.entries(repositories).map(async ([projectId, expectedNodes]) => {
      const snapshot = await loadDesignRepositorySnapshot({
        readText: await repositoryReader(projectId),
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
  'Resolves every bundled design ref and verifies its public content-addressed node closure.'
