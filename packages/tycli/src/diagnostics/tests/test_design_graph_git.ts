import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeDesignGraphGitSynchronizer } from '../../cli/designGraphGitSynchronizer.ts'
import { canonicalHash } from '@taskyon/comp-dag/caching'

export const testNodeGraphGitSourceProjectionIncludesRootLock = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-graph-source-git-'))
  try {
    const adapter = await createNodeDesignGraphGitSynchronizer({ directory })
    const files = [
      { path: 'nodes/example.ts', content: 'export default {}\n' },
      { path: 'projects/example.json', content: '{}\n' },
      { path: 'graph.lock.json', content: '{}\n' },
    ]
    let rejected = false
    try {
      await adapter.writeProjection([{ path: 'source-manifests/example.json', content: '{}' }])
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Ordinary Git adapters must reject captured source records.')
    await adapter.writeProjection(files)
    const actual = await adapter.readProjection()
    const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : 1))
    if (canonicalHash(actual) !== canonicalHash(ordered))
      throw new Error('Node Git source projection must read every source file and its root lock.')
    await adapter.writeProjection(files.slice(0, 1).concat(files.slice(2)))
    if ((await adapter.readProjection()).some((file) => file.path.startsWith('projects/')))
      throw new Error('Source projection must remove obsolete managed source files.')
    if ((await readFile(join(directory, 'graph.lock.json'), 'utf8')) !== '{}\n')
      throw new Error('Source projection must retain the committed root lock.')
    await mkdir(join(directory, 'source-manifests'))
    await writeFile(join(directory, 'source-manifests/example.json'), '{}')
    let archiveRejected = false
    try {
      await adapter.readProjection()
    } catch {
      archiveRejected = true
    }
    if (!archiveRejected)
      throw new Error('Existing portable archives require a separate Git source checkout.')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
testNodeGraphGitSourceProjectionIncludesRootLock.description =
  'Exercises the Node filesystem Git adapter with synthetic source files and a root lock, without creating commits or contacting a remote.'

export const testNodeGraphSourceLockUpdatesAreExplicitAndIdempotent = async () => {
  const { updateDesignGraphSourceDirectoryLock, readDesignGraphSourceDirectory } =
    await import('@taskyon/comp-dag/designGraphSourcesNode')
  const { compileDesignGraphSources } = await import('@taskyon/comp-dag/designGraphSources')
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-source-lock-command-'))
  try {
    await mkdir(join(directory, 'nodes'))
    const source = `export default {formatVersion: 3, outputSchema: {type: 'number'}, ids: {value: {inputs: {}}}, run: () => 3}`
    await writeFile(join(directory, 'nodes/value.ts'), source)
    if (!(await updateDesignGraphSourceDirectoryLock(directory)))
      throw new Error('Initial explicit update must create a lock.')
    const lockPath = join(directory, 'graph.lock.json')
    const content = await readFile(lockPath, 'utf8')
    const formatted = JSON.stringify(JSON.parse(content), null, 4) + '\n'
    await writeFile(lockPath, formatted)
    if (await updateDesignGraphSourceDirectoryLock(directory))
      throw new Error('Equivalent lock updates must not rewrite formatted files.')
    if ((await readFile(lockPath, 'utf8')) !== formatted)
      throw new Error('Unchanged lock bytes must remain untouched.')
    await writeFile(join(directory, 'nodes/value.ts'), source.replace('() => 3', '() => 5'))
    let staleRejected = false
    try {
      await compileDesignGraphSources(await readDesignGraphSourceDirectory(directory))
    } catch {
      staleRejected = true
    }
    if (!staleRejected || (await readFile(lockPath, 'utf8')) !== formatted)
      throw new Error('Boot must reject stale locks without updating them.')
    if (!(await updateDesignGraphSourceDirectoryLock(directory)))
      throw new Error('An explicit update must repair stale source pins.')
    await compileDesignGraphSources(await readDesignGraphSourceDirectory(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
testNodeGraphSourceLockUpdatesAreExplicitAndIdempotent.description =
  'Creates and updates a synthetic source lock explicitly, preserves unchanged formatting and rejects stale locks during boot without rewriting them.'
