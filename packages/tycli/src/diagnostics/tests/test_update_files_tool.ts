import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateFilesTool } from '../../tools/patchTool'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const withTempCwd = async <T>(prefix: string, fn: (dir: string) => Promise<T>) => {
  const previousCwd = process.cwd()
  const dir = join(tmpdir(), `${prefix}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  try {
    process.chdir(dir)
    return await fn(dir)
  } finally {
    process.chdir(previousCwd)
  }
}

export const testUpdateFilesCreatesMissingFileWithNewContent = async () =>
  await withTempCwd('tycli-update-files-create', async (dir) => {
    const result = await updateFilesTool.function?.({
      updates: [
        {
          filePath: 'nested/result.md',
          newContent: '# Saved\n\nok\n',
        },
      ],
    })

    const content = await readFile(join(dir, 'nested/result.md'), 'utf8')
    assert(content === '# Saved\n\nok\n', `Expected created file content, got ${content}`)
    assert(
      result &&
        typeof result === 'object' &&
        'ok' in result &&
        result.ok === true &&
        'updates' in result &&
        Array.isArray(result.updates) &&
        result.updates[0]?.changed === true,
      'Expected updateFiles to report a changed new file',
    )

    return { success: true }
  })

export const testUpdateFilesRejectsMixedEditModes = async () =>
  await withTempCwd('tycli-update-files-mixed', async () => {
    let message = ''
    try {
      await updateFilesTool.function?.({
        updates: [
          {
            filePath: 'result.md',
            newContent: '# Saved\n',
            patches: [{ search: 'Saved', replace: 'Updated' }],
          },
        ],
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    assert(
      message.includes('mixes multiple edit modes'),
      `Expected mixed-mode validation error, got ${message || '(none)'}`,
    )

    return { success: true }
  })

export const testUpdateFilesRejectsPathsOutsideArtifactRoot = async () =>
  await withTempCwd('tycli-update-files-artifact-root', async () => {
    let message = ''
    try {
      await updateFilesTool.function?.({
        artifactRoot: 'research/home-battery-specs',
        updates: [
          {
            filePath: 'task_artifacts/index.md',
            newContent: '# Wrong folder\n',
          },
        ],
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    assert(
      message.includes('inside artifactRoot research/home-battery-specs/'),
      `Expected artifact-root validation error, got ${message || '(none)'}`,
    )

    return { success: true }
  })

export const testUpdateFilesSchemaDeclaresExclusiveEditModes = () => {
  const updates = updateFilesTool.parameters.properties?.updates
  const itemSchema =
    updates && typeof updates === 'object' && 'items' in updates ? updates.items : undefined

  assert(
    itemSchema &&
      typeof itemSchema === 'object' &&
      'oneOf' in itemSchema &&
      Array.isArray(itemSchema.oneOf) &&
      itemSchema.oneOf.length === 3,
    'Expected updateFiles schema to declare exactly one edit mode per update',
  )
  assert(
    itemSchema &&
      typeof itemSchema === 'object' &&
      'properties' in itemSchema &&
      itemSchema.properties.filePath.description.includes('repeat that directory prefix'),
    'Expected filePath schema guidance to explain artifactRoot-prefixed paths',
  )

  return { success: true }
}

testUpdateFilesCreatesMissingFileWithNewContent.description =
  'updateFiles can create a missing nested file when the model uses newContent.'
testUpdateFilesRejectsMixedEditModes.description =
  'updateFiles returns a recoverable validation error when a provider mixes edit modes.'
testUpdateFilesRejectsPathsOutsideArtifactRoot.description =
  'updateFiles rejects research artifacts that try to write outside the selected artifact root.'
testUpdateFilesSchemaDeclaresExclusiveEditModes.description =
  'updateFiles exposes a mutually exclusive schema for newContent, patches, and regexReplacements.'
