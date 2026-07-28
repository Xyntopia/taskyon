import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createExplorationTool } from '../../tools/explorationTool'

const assert = (condition: unknown, message: string) => {
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
    const tool = createExplorationTool({})
    const listed = await tool.function({ action: 'list', path: 'inside' })
    const searched = await tool.function({ action: 'search', path: 'inside', query: 'target' })
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
      grepped.count === 1 && grepped.matches[0]?.path === 'inside/target.ts',
      'Expected grep matches to remain scoped and workspace-relative',
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
