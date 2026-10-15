import { loadBundledDesignRepositorySources } from '../examples/bundledDesignRepositories'
import {
  createDesignRepositoryFileReader,
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
    return createDesignRepositoryFileReader(await loadBundledDesignRepositorySources(projectId))
      .readText
  }
  const { fileURLToPath } = await import('node:url')
  const { readdir } = await import('node:fs/promises')
  const { readDesignGraphSourceDirectory } =
    await import('@taskyon/comp-dag/designGraphSourcesNode')
  const baseUrl = new URL(`../../../../public/design-repositories/${projectId}/`, import.meta.url)
  const paths = await readdir(fileURLToPath(baseUrl), { recursive: true })
  assert(
    paths.every(
      (path) =>
        [
          'nodes',
          'modules',
          'imports',
          'projects',
          'assets',
          'taskyon.json',
          'graph.lock.json',
        ].includes(path.split('/')[0]!) && !path.includes('sha256_'),
    ),
    `${projectId} must contain flat source files and its authored descriptor only.`,
  )
  const files = await readDesignGraphSourceDirectory(fileURLToPath(baseUrl))
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
