import { createMapCrudWrapper } from '../utils/crudWrapper'
import { createToolSettingsManager, type ToolSettingsRecord } from '../core/toolSettings'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testToolSettingsRevisionsAreScopedToOneTool() {
  const manager = createToolSettingsManager(createMapCrudWrapper<ToolSettingsRecord>(new Map()))
  const toolRevision = `sha256:${'a'.repeat(43)}` as const
  const first = await manager.store('firstTool', toolRevision, { model: 'first-model' })
  const second = await manager.store('secondTool', toolRevision, { model: 'second-model' })
  const repeated = await manager.store('firstTool', toolRevision, { model: 'first-model' })

  assert(first !== second, 'Different per-tool settings must have different revisions')
  assert(first === repeated, 'Identical settings for one tool must reuse their revision')
  assert(
    (await manager.get(first))?.settings.model === 'first-model',
    'The exact settings snapshot must be retrievable by revision',
  )
}

testToolSettingsRevisionsAreScopedToOneTool.description =
  'Content-addresses immutable settings for one exact tool revision without hashing the complete toolchain profile.'

export async function testToolSettingsRejectCrossToolResolution() {
  const manager = createToolSettingsManager(createMapCrudWrapper<ToolSettingsRecord>(new Map()))
  const toolRevision = `sha256:${'b'.repeat(43)}` as const
  const settingsRevision = await manager.store('firstTool', toolRevision, { enabled: true })

  const resolved = await manager.resolve('secondTool', toolRevision, settingsRevision)
  assert(resolved === undefined, 'A settings revision must not resolve for another tool')
}

testToolSettingsRejectCrossToolResolution.description =
  'Binds a settings snapshot to its exact tool name and immutable tool revision.'
