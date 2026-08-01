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
  await repository.writeProjection([{ path: 'refs/main.json', content: '{"nodeId":"first"}\n' }])
  const firstCommit = await repository.commit({ author, message: 'Store first definition' })
  await repository.branch('experiment', true)
  await repository.writeProjection([{ path: 'refs/main.json', content: '{"nodeId":"second"}\n' }])
  await repository.commit({ author, message: 'Store experimental definition' })
  await repository.checkout('main')
  const restored = await repository.readText('refs/main.json')

  assert(unsafePathRejected, 'Expected repository-relative projection paths')
  assert(firstCommit.length === 40, 'Expected an isomorphic-git commit id')
  assert(restored === '{"nodeId":"first"}\n', 'Expected checkout to restore the main definition')
  return { firstCommit, restored }
}

testBrowserDagGitRepositoryCommitsAndChecksOutDefinitions.description =
  'Commits and checks out deterministic DAG definitions in browser-local Git.'
