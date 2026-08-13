import { createBrowserDagGitRepository } from '../dagGitRepository.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testBrowserDagGitRepositoryCommitsAndChecksOutDefinitions = async () => {
  if (typeof indexedDB === 'undefined') {
    return { skipped: true, reason: 'Browser Git diagnostics require IndexedDB.' }
  }
  const repository = await createBrowserDagGitRepository({
    databaseName: `taskyon-dag-git-${crypto.randomUUID()}`,
  })
  const author = { name: 'Taskyon diagnostics', email: 'diagnostics@taskyon.local' }
  let unsafePathRejected = false
  try {
    await repository.writeProjection([{ path: '../outside.json', content: '{}\n' }])
  } catch {
    unsafePathRejected = true
  }
  await repository.writeProjection([
    { path: 'refs/graph/main.json', content: '{"schemaVersion":2,"revisionId":"first"}\n' },
  ])
  const firstCommit = await repository.commit({ author, message: 'Store first definition' })
  await repository.branch('experiment', true)
  await repository.writeProjection(
    [{ path: 'refs/graph/main.json', content: '{"schemaVersion":2,"revisionId":"second"}\n' }],
    'experiment',
  )
  const secondCommit = await repository.commit({
    author,
    message: 'Store experimental definition',
  })
  assert(secondCommit !== firstCommit, 'Expected the experimental definition to create a commit')
  await repository.checkout('main')
  const restored = await repository.readText('refs/graph/main.json')
  const projection = await repository.readProjection()
  const unchangedCommit = await repository.commit({
    author,
    message: 'No changes should not create a commit',
  })

  assert(unsafePathRejected, 'Expected repository-relative projection paths')
  assert(firstCommit.length === 40, 'Expected an isomorphic-git commit id')
  assert(
    restored === '{"schemaVersion":2,"revisionId":"first"}\n',
    `Expected checkout to restore the main graph ref, received ${JSON.stringify(restored)}`,
  )
  assert(projection.length === 1, 'Expected the managed Git projection to be readable for import')
  assert(unchangedCommit === firstCommit, 'Expected an unchanged projection to reuse HEAD')
  return { firstCommit, restored, projection: projection.map(({ path }) => path) }
}

testBrowserDagGitRepositoryCommitsAndChecksOutDefinitions.description =
  'Commits and checks out deterministic DAG definitions in browser-local Git.'
