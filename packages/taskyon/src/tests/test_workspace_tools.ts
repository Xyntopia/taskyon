import { createPortableTestStorage } from '../testSupport/portableTestStorage'
import {
  createStandardWorkspaceTools,
  type WorkspaceOperations,
  workspaceGlobMatches,
} from '../tools/workspaceTools'
import { createStorageWorkspaceOperations } from '../tools/storageWorkspaceOperations'
import { createExternalToolContext } from '../core/toolRpc'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const findTool = (tools: ReturnType<typeof createStandardWorkspaceTools>, name: string) => {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool?.function) throw new Error(`Expected ${name} workspace tool`)
  return tool
}

export const testStandardWorkspaceToolsExposeDirectOperations = async () => {
  const files = new Map([['src/example.ts', 'const value = 1\n']])
  const operations: WorkspaceOperations = {
    read: (path) => Promise.resolve({ content: files.get(path) ?? '', revision: 'revision-1' }),
    write: ({ path, content }) => {
      files.set(path, content)
      return Promise.resolve({ revision: 'revision-2' })
    },
    list: () => Promise.resolve([...files.keys()].map((path) => ({ path, type: 'file' as const }))),
    find: ({ pattern }) =>
      Promise.resolve([...files.keys()].filter((path) => path.includes(pattern))),
    grep: ({ pattern }) =>
      Promise.resolve(
        [...files].flatMap(([path, content]) =>
          content.includes(pattern) ? [{ path, line: 1, text: content.trimEnd() }] : [],
        ),
      ),
  }
  const tools = createStandardWorkspaceTools(operations)
  const context = createExternalToolContext(new AbortController().signal)

  assert(
    JSON.stringify(tools.map((tool) => tool.name)) ===
      JSON.stringify(['read', 'write', 'edit', 'grep', 'find', 'ls']),
    'Expected separate standard workspace tool names',
  )
  await findTool(tools, 'edit').function?.(
    {
      path: 'src/example.ts',
      edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
    },
    context,
  )
  assert(files.get('src/example.ts') === 'const value = 2\n', 'Expected edit to update content')
  assert(
    workspaceGlobMatches('**/*.ts', 'example.ts') &&
      workspaceGlobMatches('**/*.ts', 'src/example.ts'),
    'Expected recursive globs to include root and nested files',
  )
}

testStandardWorkspaceToolsExposeDirectOperations.description =
  'Creates separate direct workspace tools from one shared operations boundary.'

export const testStorageWorkspaceOperationsPersistTextFiles = async () => {
  const storage = createPortableTestStorage()
  try {
    const operations = createStorageWorkspaceOperations(storage.storageClient, 'workspace-files')
    const tools = createStandardWorkspaceTools(operations)
    const context = createExternalToolContext(new AbortController().signal)

    await findTool(tools, 'write').function?.(
      {
        path: 'src/browser.ts',
        content: 'export const browser = true\n',
      },
      context,
    )
    const read = await findTool(tools, 'read').function?.({ path: 'src/browser.ts' }, context)
    const found = await findTool(tools, 'find').function?.(
      { pattern: '*browser*', path: 'src' },
      context,
    )
    const grepped = await findTool(tools, 'grep').function?.({ pattern: 'browser = true' }, context)

    assert(
      read &&
        typeof read === 'object' &&
        'content' in read &&
        typeof read.content === 'string' &&
        read.content.includes('browser'),
      'Expected StorageClient-backed read content',
    )
    assert(
      found &&
        typeof found === 'object' &&
        'files' in found &&
        Array.isArray(found.files) &&
        found.files.length === 1,
      'Expected StorageClient-backed file discovery',
    )
    assert(
      grepped &&
        typeof grepped === 'object' &&
        'matches' in grepped &&
        Array.isArray(grepped.matches) &&
        grepped.matches.length === 1,
      'Expected StorageClient-backed text search',
    )
    const stale = await operations.read('src/browser.ts')
    await operations.write({
      path: 'src/browser.ts',
      content: 'export const browser = false\n',
      expectedRevision: stale.revision,
    })
    let conflict = ''
    try {
      await operations.write({
        path: 'src/browser.ts',
        content: 'export const browser = "stale"\n',
        expectedRevision: stale.revision,
      })
    } catch (error) {
      conflict = error instanceof Error ? error.message : String(error)
    }
    assert(conflict.includes('changed while editing'), 'Expected stale browser edit rejection')
    await operations.read('../outside.ts').then(
      () => {
        throw new Error('Expected virtual workspace traversal rejection')
      },
      (error: unknown) => {
        assert(String(error).includes('escapes its root'), 'Expected traversal-specific error')
      },
    )
  } finally {
    storage.destroy()
  }
}

testStorageWorkspaceOperationsPersistTextFiles.description =
  'Uses StorageClient records as a browser-portable text workspace backend.'
