import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createExplorationTool, formatExplorationContext } from '../../tools/explorationTool'
import { createNodeWorkspaceOperations } from '../../tools/nodeWorkspaceOperations'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testExplorationScopesDiscoveryToRequestedPath = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tycli-exploration-diagnostic-'))
  await mkdir(join(workspace, 'inside'), { recursive: true })
  await mkdir(join(workspace, 'outside'), { recursive: true })
  await writeFile(join(workspace, 'inside', 'target.ts'), 'export const marker = "scoped"\n')
  await writeFile(join(workspace, 'outside', 'target.ts'), 'export const marker = "outside"\n')

  const previousCwd = process.cwd()
  process.chdir(workspace)
  try {
    const tool = createExplorationTool({}, createNodeWorkspaceOperations(workspace))
    const listed = await tool.function({ action: 'list', path: 'inside' })
    const searched = await tool.function({ action: 'search', path: 'inside', query: 'target' })
    const searchedFile = await tool.function({
      action: 'search',
      path: 'inside/target.ts',
      query: 'target',
    })
    const unmatchedFileSearch = await tool.function({
      action: 'search',
      path: 'inside/target.ts',
      query: 'missing',
    })
    const grepped = await tool.function({ action: 'grep', path: 'inside', query: 'marker' })
    const greppedFile = await tool.function({
      action: 'grep',
      path: 'inside/target.ts',
      query: 'marker',
    })

    assert(
      JSON.stringify(listed) === JSON.stringify({ files: ['inside/target.ts'], count: 1 }),
      'Expected list to return workspace-relative files only below the requested path',
    )
    assert(
      JSON.stringify(searched) === JSON.stringify({ files: ['inside/target.ts'], count: 1 }),
      'Expected search to apply its query only below the requested path',
    )
    assert(
      JSON.stringify(searchedFile) === JSON.stringify({ files: ['inside/target.ts'], count: 1 }),
      'Expected search to accept a matching single-file path',
    )
    assert(
      JSON.stringify(unmatchedFileSearch) === JSON.stringify({ files: [], count: 0 }),
      'Expected search to omit a single file whose path does not match the query',
    )
    assert(
      'matches' in grepped && Array.isArray(grepped.matches),
      'Expected grep to return matches',
    )
    assert(
      grepped.count === 1 && grepped.matches[0]?.path === 'inside/target.ts',
      'Expected grep matches to remain scoped and workspace-relative',
    )
    assert(
      'matches' in greppedFile && Array.isArray(greppedFile.matches),
      'Expected single-file grep to return matches',
    )
    assert(
      greppedFile.count === 1 && greppedFile.matches[0]?.path === 'inside/target.ts',
      'Expected grep to accept a single-file path and return a workspace-relative match',
    )
  } finally {
    process.chdir(previousCwd)
  }
}

testExplorationScopesDiscoveryToRequestedPath.description =
  'Scopes exploration list, search, and grep actions to their requested workspace directory or file.'

export const testExplorationBatchesAndInvalidatesExplicitContext = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tycli-exploration-context-diagnostic-'))
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'first.ts'), 'export const first = true\n')
  await writeFile(join(workspace, 'src', 'second.ts'), 'export const second = true\n')
  const context: Record<string, string> = {}
  const operations = createNodeWorkspaceOperations(workspace, {
    onDidWrite: (path) => delete context[path],
  })
  const tool = createExplorationTool(context, operations)

  const inspected = await tool.function({
    action: 'inspect',
    operations: [
      { action: 'view', path: 'src/first.ts' },
      { action: 'grep', path: 'src', query: 'second' },
    ],
  })
  assert(
    'count' in inspected && inspected.count === 2,
    'Expected inspect to run two independent bounded operations',
  )
  await tool.function({ action: 'add', path: 'src/first.ts' })
  assert(
    formatExplorationContext(context).includes('src/first.ts'),
    'Expected explicitly added context to be injectable',
  )
  await operations.write({ path: 'src/first.ts', content: 'export const first = false\n' })
  assert(
    formatExplorationContext(context) === '',
    'Expected writes to invalidate stale explicit context',
  )
}

testExplorationBatchesAndInvalidatesExplicitContext.description =
  'Batches independent exploration operations and invalidates explicitly loaded files after writes.'

export const testNodeWorkspaceRejectsSymlinkEscape = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tycli-workspace-symlink-diagnostic-'))
  const outside = await mkdtemp(join(tmpdir(), 'tycli-workspace-outside-diagnostic-'))
  await writeFile(join(outside, 'secret.txt'), 'outside\n')
  await symlink(outside, join(workspace, 'escaped'))
  const operations = createNodeWorkspaceOperations(workspace)
  let message = ''
  try {
    await operations.read('escaped/secret.txt')
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('escapes workspace'), `Expected symlink escape rejection, got ${message}`)
}

testNodeWorkspaceRejectsSymlinkEscape.description =
  'Rejects Node workspace reads that escape through an in-workspace symbolic link.'
